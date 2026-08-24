/**
 * `@xenosystem/elements-react` — the XENO web renderer (React + SVG).
 *
 * - {@link XenoElement} renders any element DECLARATION (icons + stateful glyphs) from data.
 * - Tier-1 CONTROLS (Button, IconButton, ToggleButton, Switch, TextInput, Textarea) are the first
 *   non-icon elements — styled from the design tokens, CSS-first, behaviour hand-rolled (Base UI later).
 * - Tier-2 ELEMENTS (containers, overlays, forms, content, nav, layout, status) compose the controls
 *   and the renderer into the surfaces a chat/agent product needs.
 *
 * Import the styles once:
 *   `@xenosystem/elements-react/xeno-elements.css`  (theme tokens + element + control + every element style)
 * or à la carte:
 *   `@xenosystem/elements-react/xeno-theme.css`  (tokens as CSS vars; scope with a `.xeno` element)
 *   `@xenosystem/elements-react/controls.css`    (control styles)
 *
 * Glyphs are DATA: import each per-id from `@xenosystem/elements/elements/<id>`. No barrel.
 *
 * @module
 */
export { XenoElement, type XenoElementProps } from './XenoElement.js'
export { useDialog, type UseDialogOptions, type UseDialogResult } from './useDialog.js'
export { useTabs, type UseTabsOptions, type UseTabsResult } from './useTabs.js'
export { useMenu, type UseMenuOptions, type UseMenuResult } from './useMenu.js'
export {
  useGooPill,
  type UseGooPillOptions,
  type UseGooPillResult,
} from './useGooPill.js'

// ── Tier-1 controls ─────────────────────────────────────────────────────────────────────────────
export { Button, type ButtonProps, type ButtonVariant } from './controls/Button.js'
export { IconButton, type IconButtonProps } from './controls/IconButton.js'
export { ConfirmButton, type ConfirmButtonProps } from './controls/ConfirmButton.js'
export { ToggleButton, type ToggleButtonProps } from './controls/ToggleButton.js'
export { Switch, type SwitchProps } from './controls/Switch.js'
export { TextInput, type TextInputProps } from './controls/TextInput.js'
export { Textarea, type TextareaProps } from './controls/Textarea.js'
export type { ControlSizeToken } from './controls/util.js'

// ── Containers ──────────────────────────────────────────────────────────────────────────────────
export { Card, type CardProps, type CardVariant } from './containers/Card.js'
export { Panel, type PanelProps } from './containers/Panel.js'
export { Chip, type ChipProps, type ChipSize } from './containers/Chip.js'
export { Tile, type TileProps } from './containers/Tile.js'
export { MessageBubble, type MessageBubbleProps, type MessageRole } from './containers/MessageBubble.js'
export { Badge, type BadgeProps } from './containers/Badges.js'
export { StatusPill, type StatusPillProps, type StatusTone } from './containers/Badges.js'
export { CountBadge, type CountBadgeProps } from './containers/Badges.js'
export { CitationBadge, type CitationBadgeProps } from './containers/Badges.js'
export { Avatar, type AvatarProps } from './containers/Avatar.js'
export { AvatarStack, type AvatarStackProps, type AvatarStackItem } from './containers/Avatar.js'
export { ListRow, type ListRowProps } from './containers/ListRow.js'
export {
  Table,
  type TableProps,
  THead,
  type THeadProps,
  TBody,
  type TBodyProps,
  Tr,
  type TrProps,
  Th,
  type ThProps,
  Td,
  type TdProps,
  type ColumnAlign,
} from './containers/Table.js'
export { DataTable, type DataTableProps, type DataTableColumn } from './containers/DataTable.js'

// ── Overlays ────────────────────────────────────────────────────────────────────────────────────
export { Popover, type PopoverProps } from './overlays/Popover.js'
export { Menu, type MenuProps } from './overlays/Menu.js'
export { MenuItem, type MenuItemProps, type MenuItemVariant } from './overlays/MenuItem.js'
export { Modal, Sheet, type ModalProps, type SheetProps, type ModalVariant } from './overlays/Modal.js'
export { Tabs, type TabsProps, type TabItem, Tab, type TabProps } from './overlays/Tabs.js'
export { SegmentedControl, type SegmentedControlProps, type SegmentedOption } from './overlays/SegmentedControl.js'
export { PillFilter, type PillFilterProps, type PillOption } from './overlays/PillFilter.js'
export { Tooltip, type TooltipProps, type TooltipSide } from './overlays/Tooltip.js'
export { PickerField, type PickerFieldProps } from './overlays/PickerField.js'
export { Reveal, type RevealProps } from './overlays/Reveal.js'
export { DatePicker, type DatePickerProps, TimePicker, type TimePickerProps } from './overlays/DateTimePicker.js'
export type { DateParts, MonthParts, TimeValue, Meridiem } from './overlays/DateTimePicker.js'

// ── Forms ───────────────────────────────────────────────────────────────────────────────────────
export { Checkbox, type CheckboxProps, type CheckboxState } from './forms/Checkbox.js'
export { RadioGroup, type RadioGroupProps, RadioRow, type RadioRowProps, type RadioOption } from './forms/RadioGroup.js'

// ── Content ─────────────────────────────────────────────────────────────────────────────────────
export {
  CodeBlock,
  type CodeBlockProps,
  type CodeBlockOutput,
  type CodeBlockOutputStatus,
} from './content/CodeBlock.js'
export { SourceCard, type SourceCardProps } from './content/SourceCard.js'
export { SourcesDisclosure, type SourcesDisclosureProps, type SourceRef } from './content/SourcesDisclosure.js'
export { ModelPicker, type ModelPickerProps, type ModelOption, type ModelPickerLayout } from './content/ModelPicker.js'
export { InlineCode, type InlineCodeProps } from './content/InlineCode.js'
export { Callout, type CalloutProps, type CalloutTone } from './content/Callout.js'
export { Collapsible, type CollapsibleProps } from './content/Collapsible.js'
export { Caret, type CaretProps } from './content/Caret.js'

// ── Nav ─────────────────────────────────────────────────────────────────────────────────────────
export { Sidebar, type SidebarProps, type SidebarItem, type SidebarSection } from './nav/Sidebar.js'

// ── Layout ──────────────────────────────────────────────────────────────────────────────────────
export { ResizablePanel, type ResizablePanelProps, type ResizablePanelSide } from './layout/ResizablePanel.js'

// ── Status ──────────────────────────────────────────────────────────────────────────────────────
export { ThinkingCube, type ThinkingCubeProps, type ThinkingCubeState } from './status/ThinkingCube.js'
export { Spinner, type SpinnerProps } from './status/Spinner.js'
export { ProgressBar, type ProgressBarProps } from './status/ProgressBar.js'
export { StepTimeline, type StepTimelineProps, type Step, type StepStatus } from './status/StepTimeline.js'
export { StatusIndicator, type StatusIndicatorProps, type StatusIndicatorTone } from './status/StatusIndicator.js'
