//! Laying the Roblox clients out so they behave like one workspace.
//!
//! Every client stays a real top-level window — nothing is reparented, so Roblox
//! keeps its own input, rendering and fullscreen handling. This module only decides
//! where each window sits and how big it is.
//!
//! Kept free of Tauri types on purpose: it is geometry plus four Win32 calls, so it
//! can be reasoned about and tested without an app running.

#![allow(dead_code)]

#[cfg(windows)]
mod win {
    pub type Handle = *mut core::ffi::c_void;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    pub struct Rect {
        pub left: i32,
        pub top: i32,
        pub right: i32,
        pub bottom: i32,
    }

    unsafe extern "system" {
        pub fn SetWindowPos(
            window: Handle,
            after: Handle,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            flags: u32,
        ) -> i32;
        pub fn ShowWindow(window: Handle, command: i32) -> i32;
        pub fn GetWindowRect(window: Handle, rect: *mut Rect) -> i32;
        pub fn IsIconic(window: Handle) -> i32;
        pub fn SystemParametersInfoW(action: u32, param: u32, out: *mut Rect, flags: u32) -> i32;
        pub fn GetSystemMetrics(index: i32) -> i32;
    }

    /// SWP_NOZORDER | SWP_NOACTIVATE — move and resize without stealing focus.
    pub const SWP_LAYOUT: u32 = 0x0004 | 0x0010;
    /// SWP_NOZORDER only — keep the current size.
    pub const SWP_MOVE_ONLY: u32 = 0x0004;
    pub const SW_SHOWNOACTIVATE: i32 = 4;
    pub const SW_MINIMISE: i32 = 6;
    pub const SW_RESTORE: i32 = 9;
    /// SPI_GETWORKAREA: the desktop minus the taskbar.
    pub const SPI_GETWORKAREA: u32 = 0x0030;
    /// SM_CXVIRTUALSCREEN / SM_CYVIRTUALSCREEN, for a sanity check on absurd areas.
    pub const SM_CYVIRTUALSCREEN: i32 = 79;
}

/// One client window to place.
#[derive(Debug, Clone, Copy)]
pub struct Slot {
    pub hwnd: i64,
}

/// How big the clients should end up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Size {
    /// A comfortable window you can actually play in.
    Normal,
    /// Deliberately small: enough to see what an alt is doing, cheap to keep open.
    Micro,
}

impl Size {
    pub fn from_str(value: &str) -> Self {
        match value {
            "micro" => Size::Micro,
            _ => Size::Normal,
        }
    }

    /// Target width per client. Micro is sized to stay readable in a grid rather
    /// than to match Roblox's own 800x600 floor — we set the size after the client
    /// has already opened, so the floor doesn't apply.
    fn target_width(self, count: usize) -> i32 {
        match self {
            Size::Micro => 380,
            Size::Normal => {
                // Two clients get half the screen each, not one per row.
                if count <= 2 {
                    860
                } else {
                    640
                }
            }
        }
    }

    fn gap(self) -> i32 {
        match self {
            Size::Micro => 8,
            Size::Normal => 14,
        }
    }
}

/// Where a single window should go.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Placement {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// A rectangle of desktop to lay out inside.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Area {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl Area {
    pub fn columns_for(&self, count: usize, size: Size) -> usize {
        if count == 0 {
            return 1;
        }
        let per = size.target_width(count) + size.gap();
        let fitting = (self.width / per.max(1)).max(1) as usize;
        // Never more columns than clients, and never so many that a client ends up
        // narrower than a readable minimum.
        fitting.min(count).min(6).max(1)
    }

    /// Row-major grid: fill left to right, then wrap. The last row is centred, which
    /// looks deliberate rather than ragged when the count doesn't divide evenly.
    pub fn grid(&self, count: usize, size: Size) -> Vec<Placement> {
        if count == 0 {
            return Vec::new();
        }
        let gap = size.gap();
        let columns = self.columns_for(count, size);
        let rows = count.div_ceil(columns);

        let cell_w = (self.width - gap * (columns as i32 - 1)).max(1) / columns as i32;
        let cell_h = (self.height - gap * (rows as i32 - 1)).max(1) / rows as i32;

        // Micro clients keep their aspect ratio instead of stretching to the cell.
        let (width, height) = match size {
            Size::Micro => {
                let w = cell_w.min(size.target_width(count));
                (w, (w as f32 * 0.62) as i32)
            }
            Size::Normal => (cell_w, cell_h),
        };

        let mut out = Vec::with_capacity(count);
        for index in 0..count {
            let row = index / columns;
            let column = index % columns;
            let in_row = if row == rows - 1 {
                count - row * columns
            } else {
                columns
            };
            let row_width = in_row as i32 * width + (in_row as i32 - 1).max(0) * gap;
            let row_x = self.x + (self.width - row_width) / 2;
            let x = row_x + column as i32 * (width + gap);
            let y = self.y + row as i32 * (cell_h + gap);
            out.push(Placement { x, y, width, height });
        }
        out
    }
}

/// Which half of the desktop a group is arranged in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Left,
    Right,
}

/// One half of `area`, with a gap between the halves so the group never sits
/// flush against whatever is on the other side.
///
/// The split is a plain half, not a percentage setting: the point is that the
/// other half stays usable, and any window that wants to live there already
/// fits.
const HALF_GAP: i32 = 14;

pub fn half(area: Area, side: Side) -> Area {
    let width = ((area.width - HALF_GAP) / 2).max(1);
    let x = match side {
        Side::Left => area.x,
        Side::Right => area.x + area.width - width,
    };
    Area {
        x,
        y: area.y,
        width,
        height: area.height,
    }
}

/// The half a group already sits in, judged by where its windows are.
///
/// Keeping the group on the side it was already on means gathering it does not
/// also drag it across the screen — and the half it leaves behind is the half
/// the user was not using for clients. A tie, or a group spread evenly, goes
/// right, which is where most people park alts.
pub fn side_for(area: Area, centres: &[i32]) -> Side {
    let middle = area.x + area.width / 2;
    let left = centres.iter().filter(|x| **x < middle).count();
    let right = centres.len() - left;
    if right >= left {
        Side::Right
    } else {
        Side::Left
    }
}

/// The middle of a window, if it has a position worth trusting.
///
/// A minimised or hidden window reports -32000, and those coordinates must not
/// drag the group's decision — so anything absurd is ignored rather than clamped.
#[cfg(windows)]
fn centre_x(hwnd: i64) -> Option<i32> {
    let handle = hwnd as win::Handle;
    if handle.is_null() || unsafe { win::IsIconic(handle) != 0 } {
        return None;
    }
    let mut rect = win::Rect::default();
    if unsafe { win::GetWindowRect(handle, &mut rect) } == 0 {
        return None;
    }
    let centre = (rect.left + rect.right) / 2;
    (-10_000..100_000).contains(&centre).then_some(centre)
}

/// The half of the desktop these clients should be gathered into.
#[cfg(windows)]
pub fn group_area(slots: &[Slot], area: Area) -> Area {
    let centres: Vec<i32> = slots.iter().filter_map(|slot| centre_x(slot.hwnd)).collect();
    half(area, side_for(area, &centres))
}

/// The usable desktop, excluding the taskbar.
#[cfg(windows)]
pub fn work_area() -> Area {
    unsafe {
        let mut rect = win::Rect::default();
        let ok = win::SystemParametersInfoW(win::SPI_GETWORKAREA, 0, &mut rect, 0) != 0;
        if ok && rect.right > rect.left && rect.bottom > rect.top {
            return Area {
                x: rect.left,
                y: rect.top,
                width: rect.right - rect.left,
                height: rect.bottom - rect.top,
            };
        }
        // Fallback: a 1080p desktop, so a failure still lays out somewhere sensible.
        Area { x: 0, y: 0, width: 1920, height: 1040 }
    }
}

/// Lays the given client windows out in a grid inside `area`.
///
/// Minimised clients are restored first: moving an iconic window does nothing on
/// Windows, so without this the tiling would silently skip every client the user had
/// tucked away — which is most of them.
#[cfg(windows)]
pub fn tile(slots: &[Slot], area: Area, size: Size) -> Result<usize, String> {
    let placements = area.grid(slots.len(), size);
    let mut moved = 0;
    for (slot, placement) in slots.iter().zip(placements) {
        let hwnd = slot.hwnd as win::Handle;
        if hwnd.is_null() {
            continue;
        }
        unsafe {
            if win::IsIconic(hwnd) != 0 {
                win::ShowWindow(hwnd, win::SW_RESTORE);
            }
            let ok = win::SetWindowPos(
                hwnd,
                core::ptr::null_mut(),
                placement.x,
                placement.y,
                placement.width,
                placement.height,
                win::SWP_LAYOUT,
            );
            if ok != 0 {
                moved += 1;
            }
        }
    }
    if moved == 0 {
        return Err("No client windows could be moved.".into());
    }
    Ok(moved)
}

/// Moves every window to `x, y` without touching its size.
#[cfg(windows)]
pub fn move_all(slots: &[Slot], x: i32, y: i32) -> Result<usize, String> {
    let mut moved = 0;
    for slot in slots {
        let hwnd = slot.hwnd as win::Handle;
        if hwnd.is_null() {
            continue;
        }
        unsafe {
            if win::IsIconic(hwnd) != 0 {
                win::ShowWindow(hwnd, win::SW_RESTORE);
            }
            if win::SetWindowPos(hwnd, core::ptr::null_mut(), x, y, 0, 0, win::SWP_MOVE_ONLY) != 0 {
                moved += 1;
            }
        }
    }
    Ok(moved)
}

/// Current outer size of a window, for remembering what to restore to.
#[cfg(windows)]
pub fn size_of(hwnd: i64) -> Option<(i32, i32)> {
    let handle = hwnd as win::Handle;
    if handle.is_null() {
        return None;
    }
    let mut rect = win::Rect::default();
    let ok = unsafe { win::GetWindowRect(handle, &mut rect) } != 0;
    if !ok {
        return None;
    }
    Some((rect.right - rect.left, rect.bottom - rect.top))
}

/// Tucks every client away. Returns how many Windows actually minimised.
#[cfg(windows)]
pub fn minimise(slots: &[Slot]) -> usize {
    let mut done = 0;
    for slot in slots {
        let handle = slot.hwnd as win::Handle;
        if handle.is_null() {
            continue;
        }
        unsafe {
            win::ShowWindow(handle, win::SW_MINIMISE);
            if win::IsIconic(handle) != 0 {
                done += 1;
            }
        }
    }
    done
}

/// Brings every minimised client back at its old size, without stealing focus from
/// whichever window the user is actually typing in.
#[cfg(windows)]
pub fn restore(slots: &[Slot]) -> usize {
    let mut done = 0;
    for slot in slots {
        let handle = slot.hwnd as win::Handle;
        if handle.is_null() {
            continue;
        }
        unsafe {
            if win::IsIconic(handle) != 0 {
                win::ShowWindow(handle, win::SW_RESTORE);
                done += 1;
            }
        }
    }
    done
}

/// True if the window is minimised, so the UI can stop guessing from stale state.
#[cfg(windows)]
pub fn is_minimised(hwnd: i64) -> bool {
    let handle = hwnd as win::Handle;
    !handle.is_null() && unsafe { win::IsIconic(handle) != 0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn desktop() -> Area {
        Area { x: 0, y: 0, width: 1920, height: 1040 }
    }

    #[test]
    fn nothing_to_tile_is_not_an_error() {
        assert!(desktop().grid(0, Size::Normal).is_empty());
    }

    #[test]
    fn every_client_gets_a_placement() {
        for count in 1..=24 {
            let placements = desktop().grid(count, Size::Micro);
            assert_eq!(placements.len(), count, "count {count}");
        }
    }

    #[test]
    fn placements_stay_inside_the_area() {
        for count in 1..=24 {
            for placement in desktop().grid(count, Size::Normal) {
                assert!(placement.x >= 0, "count {count}");
                assert!(placement.y >= 0, "count {count}");
                assert!(placement.x + placement.width <= 1920, "count {count} overflows");
                assert!(placement.y + placement.height <= 1040, "count {count} overflows");
            }
        }
    }

    #[test]
    fn placements_never_overlap() {
        for count in 1..=16 {
            let placements = desktop().grid(count, Size::Normal);
            for (i, a) in placements.iter().enumerate() {
                for b in placements.iter().skip(i + 1) {
                    let disjoint = a.x + a.width <= b.x
                        || b.x + b.width <= a.x
                        || a.y + a.height <= b.y
                        || b.y + b.height <= a.y;
                    assert!(disjoint, "count {count}: {a:?} overlaps {b:?}");
                }
            }
        }
    }

    #[test]
    fn micro_is_smaller_than_normal() {
        let micro = desktop().grid(6, Size::Micro);
        let normal = desktop().grid(6, Size::Normal);
        assert!(micro[0].width < normal[0].width);
    }

    #[test]
    fn one_client_fills_the_row() {
        let placements = desktop().grid(1, Size::Normal);
        assert_eq!(placements[0].width, 1920);
        assert_eq!(placements[0].height, 1040);
    }

    #[test]
    fn halves_do_not_overlap_and_leave_a_gap() {
        let area = desktop();
        let left = half(area, Side::Left);
        let right = half(area, Side::Right);
        assert_eq!(left.x, area.x);
        assert_eq!(right.x + right.width, area.x + area.width);
        assert!(left.x + left.width <= right.x, "halves must not touch");
        assert_eq!(left.height, area.height);
    }

    #[test]
    fn the_group_stays_on_the_side_it_was_on() {
        let area = desktop();
        // Three windows on the left of a 1920-wide desktop.
        assert_eq!(side_for(area, &[100, 300, 800]), Side::Left);
        // Two on the right, one on the left.
        assert_eq!(side_for(area, &[100, 1500, 1700]), Side::Right);
        // Evenly split, and nothing known: the default is the right half.
        assert_eq!(side_for(area, &[100, 1500]), Side::Right);
        assert_eq!(side_for(area, &[]), Side::Right);
    }

    #[test]
    fn a_group_in_one_half_still_gets_a_full_grid() {
        let area = half(desktop(), Side::Right);
        let placements = area.grid(3, Size::Normal);
        assert_eq!(placements.len(), 3);
        for placement in &placements {
            assert!(placement.x >= area.x);
            assert!(placement.x + placement.width <= area.x + area.width);
        }
    }

    #[test]
    fn last_row_is_centred() {
        // Five clients in a three-column grid: the second row holds two.
        let area = Area { x: 0, y: 0, width: 2000, height: 1000 };
        let placements = area.grid(5, Size::Normal);
        let last = &placements[3..];
        let left_margin = last[0].x;
        let right_margin = area.width - (last[1].x + last[1].width);
        assert_eq!(left_margin, right_margin, "row should be centred");
    }
}
