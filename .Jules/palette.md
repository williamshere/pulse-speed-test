## 2024-10-30 - Added Focus Visible State
**Learning:** The app lacked a global `:focus-visible` outline for keyboard navigation, making it hard to see which element is currently focused when navigating with Tab.
**Action:** Always verify keyboard accessibility by pressing Tab and ensuring focus states exist on all interactive elements. Added a global `:focus-visible` rule in `style.css`.
