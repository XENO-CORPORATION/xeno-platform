import { StrictMode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ElementDeclaration, Selection } from '@xenosystem/elements/schema'
import {
  XenoElement,
  Button,
  IconButton,
  ConfirmButton,
  ToggleButton,
  Switch,
  TextInput,
  Textarea,
  // Tier-2 elements
  Card,
  Panel,
  Chip,
  Tile,
  MessageBubble,
  Badge,
  StatusPill,
  CountBadge,
  CitationBadge,
  Avatar,
  AvatarStack,
  ListRow,
  Table,
  THead,
  TBody,
  Tr,
  Th,
  Td,
  DataTable,
  Menu,
  MenuItem,
  Modal,
  Sheet,
  Tabs,
  SegmentedControl,
  PillFilter,
  Tooltip,
  DatePicker,
  TimePicker,
  Reveal,
  Checkbox,
  RadioGroup,
  CodeBlock,
  SourceCard,
  SourcesDisclosure,
  ModelPicker,
  InlineCode,
  Callout,
  Collapsible,
  Caret,
  Sidebar,
  ResizablePanel,
  ThinkingCube,
  Spinner,
  ProgressBar,
  StepTimeline,
  StatusIndicator,
} from '@xenosystem/elements-react'
import type { MonthParts, DateParts, TimeValue } from '@xenosystem/elements-react'
import { Liquid } from 'liquid-gooey'
import '../../elements-react/src/fonts.css'
import '../../elements-react/src/xeno-elements.css'
import './styles.css'

// Load every declaration straight from source — the same files the contract package ships.
const modules = import.meta.glob<{ default: ElementDeclaration }>('../../elements/src/elements/*.ts', {
  eager: true,
})
const DECLS: ElementDeclaration[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => a.id.localeCompare(b.id))
const byId = (id: string) => {
  const d = DECLS.find((x) => x.id === id)
  if (!d) throw new Error(`missing glyph: ${id}`)
  return d
}
const Send = byId('xeno.send')
const Search = byId('xeno.search')
const Plus = byId('xeno.plus')
const Gear = byId('xeno.gear')
const Mic = byId('xeno.mic')
const Trash = byId('xeno.trash')

// Extra glyphs the Tier-2 gallery renders (declarations resolved by id — no per-icon imports).
const Bookmark = byId('xeno.bookmark')
const Star = byId('xeno.star')
const Image = byId('xeno.image')
const File = byId('xeno.file')
const Folder = byId('xeno.folder')
const Copy = byId('xeno.copy')
const Refresh = byId('xeno.refresh')
const User = byId('xeno.user')
const ChevronDown = byId('xeno.chevron-down')
const ChevronRight = byId('xeno.chevron-right')
const Edit = byId('xeno.edit')
const Download = byId('xeno.download')
const Share = byId('xeno.share')
const Link = byId('xeno.link')
const Home = byId('xeno.home')
const Message = byId('xeno.message')
const Clock = byId('xeno.clock')
const Info = byId('xeno.info')

const shortId = (id: string) => id.replace(/^xeno\./, '')
const nextSelection: Record<Selection, Selection> = { off: 'on', on: 'off', mixed: 'off' }

function ControlsShowcase() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [pinned, setPinned] = useState(true)
  const [memory, setMemory] = useState(true)
  const [busy, setBusy] = useState(false)
  const [enterKey, setEnterKey] = useState(0)

  return (
    <section className="xeno panel" data-theme={theme}>
      <div className="panel-head">
        <h2>Tier-1 controls</h2>
        <label className="theme-toggle">
          <span>{theme === 'dark' ? 'Dark' : 'Light'}</span>
          <Switch
            checked={theme === 'light'}
            onCheckedChange={(v) => setTheme(v ? 'light' : 'dark')}
            aria-label="Toggle light theme"
          />
        </label>
      </div>

      <div className="row">
        <span className="tag">Button · variants</span>
        <Button variant="primary" leadingIcon={Send}>Send</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="outline" leadingIcon={Plus}>New</Button>
        <Button variant="danger" leadingIcon={Trash}>Delete</Button>
      </div>

      <div className="row">
        <span className="tag">Button · sizes</span>
        <Button size="xs">xs</Button>
        <Button size="sm">sm</Button>
        <Button size="md">md</Button>
        <Button size="lg">lg</Button>
      </div>

      <div className="row">
        <span className="tag">Button · states</span>
        <Button variant="primary" disabled>Disabled</Button>
        <Button variant="primary" busy={busy} onClick={() => setBusy((b) => !b)}>
          {busy ? 'Working…' : 'Toggle busy'}
        </Button>
      </div>

      <div className="row">
        <span className="tag">IconButton</span>
        <IconButton icon={Plus} aria-label="Add" />
        <IconButton icon={Search} aria-label="Search" variant="outline" />
        <IconButton icon={Gear} aria-label="Settings" variant="secondary" />
        <IconButton icon={Mic} aria-label="Voice" size="sm" />
        <IconButton icon={Trash} aria-label="Delete" variant="danger" />
      </div>

      <div className="row">
        <span className="tag">Toggle · Switch</span>
        <ToggleButton
          pressed={pinned}
          onPressedChange={setPinned}
          leadingIcon={Bookmark}
          pressedChildren="Pinned"
        >
          Pin
        </ToggleButton>
        <label className="switch-row">
          <Switch checked={memory} onCheckedChange={setMemory} aria-label="Memory" />
          <span>Memory {memory ? 'on' : 'off'}</span>
        </label>
      </div>

      <div className="row">
        <span className="tag">Inputs</span>
        <TextInput placeholder="Title…" />
        <TextInput leadingIcon={Search} placeholder="Search…" type="search" />
      </div>

      <div className="row">
        <span className="tag">Textarea</span>
        <Textarea placeholder="Message XENO…" rows={2} />
      </div>

      <div className="row">
        <span className="tag">Motion</span>
        <Button variant="secondary" onClick={() => setEnterKey((k) => k + 1)}>
          Replay entrance
        </Button>
        <Button key={enterKey} variant="primary" enter leadingIcon={Send}>
          Send
        </Button>
        <ConfirmButton icon={Copy} aria-label="Copy" confirmLabel="Copied" variant="outline" />
        <span style={{ color: 'var(--xeno-muted)', fontSize: 12 }}>
          entrance · copy→check · (press-hold the switch, hover the strong-lift card)
        </span>
      </div>

      <div className="row">
        <span className="tag">Liquid (experiment)</span>
        <LiquidToggle label="Sync" />
        <span style={{ color: 'var(--xeno-muted)', fontSize: 12 }}>
          liquid-gooey on a knob big enough to read it — the surface rubber-slides + trails a droplet
        </span>
      </div>
    </section>
  )
}

// ── Tier-2 gallery ────────────────────────────────────────────────────────────────────────────────

function ChipFilters() {
  const [filter, setFilter] = useState('all')
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <Chip selected={filter === 'all'} onSelectedChange={() => setFilter('all')}>All</Chip>
      <Chip selected={filter === 'docs'} onSelectedChange={() => setFilter('docs')}>Docs</Chip>
      <Chip leadingIcon={Image} selected={filter === 'images'} onSelectedChange={() => setFilter('images')}>
        Images
      </Chip>
    </div>
  )
}

function ContainersSection() {
  return (
    <section className="xeno panel">
      <div className="panel-head"><h2>Containers</h2></div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', paddingTop: 4 }}>
        <Card header="Usage" footer="Updated 2m ago">
          <div style={{ fontSize: 28, fontWeight: 600, color: 'var(--xeno-text)' }}>12,480</div>
          <div style={{ color: 'var(--xeno-muted)', fontSize: 13 }}>tokens this week</div>
        </Card>
        <Card variant="elevated" interactive lift="strong" header="Elevated · strong lift">
          <div style={{ color: 'var(--xeno-muted)', fontSize: 13, lineHeight: 1.5 }}>
            Hover to see the artifact-card lift — a bigger rise plus one soft, hue-free shadow.
          </div>
        </Card>
        <Panel
          title="Research trace"
          actions={<Button size="sm" variant="ghost">Clear</Button>}
          style={{ gridColumn: '1 / -1', height: 190 }}
        >
          {/* Deliberately longer than the panel: this is the one place in the playground that reliably
              OVERFLOWS, so it is where the system scrollbar can actually be seen doing its thing —
              nothing at rest, the rail arriving the moment the pointer enters. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              'Reading the spec…',
              'Searching the codebase…',
              'Cross-checking tokens…',
              'Resolving the glyph declarations…',
              'Diffing against the locked grammar…',
              'Measuring the contrast pairs…',
              'Replaying the motion curves…',
              'Checking reduced-motion fallbacks…',
              'Drafting the answer…',
            ].map((step) => (
              <div key={step} style={{ color: 'var(--xeno-muted)', fontSize: 13 }}>{step}</div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="row">
        <span className="tag">Chip · Tile</span>
        <Chip>Design</Chip>
        <Chip selected>Selected</Chip>
        <Chip leadingIcon={Bookmark}>Saved</Chip>
        <Chip onRemove={() => {}}>Removable</Chip>
        <Chip disabled>Disabled</Chip>
        <Tile icon={File} />
        <Tile icon={Folder} />
        <Tile icon={Image} size={40} />
      </div>

      <div className="row">
        <span className="tag">Chip · filter</span>
        <ChipFilters />
      </div>

      <div className="row">
        <span className="tag">Badges</span>
        <Badge>New</Badge>
        <CountBadge count={3} />
        <CountBadge count={128} max={99} />
        <StatusPill tone="neutral">Draft</StatusPill>
        <StatusPill tone="success" dot>Live</StatusPill>
        <StatusPill tone="warning" dot>Degraded</StatusPill>
        <StatusPill tone="danger" dot>Down</StatusPill>
        <span style={{ color: 'var(--xeno-muted)', fontSize: 13 }}>
          Grounded <CitationBadge index={1} /> and auditable <CitationBadge index={2} label="DOC" />.
        </span>
      </div>

      <div className="row">
        <span className="tag">Avatar</span>
        <Avatar name="Ada Lovelace" size={32} />
        <Avatar icon={User} name="Research Agent" size={32} />
        <Avatar name="Xeno" size={32} />
        <AvatarStack
          size={32}
          max={4}
          items={[
            { name: 'Ada Lovelace' },
            { name: 'Grace Hopper' },
            { icon: User, name: 'Research Agent' },
            { name: 'Edith Clarke' },
            { name: 'Hedy Lamarr' },
          ]}
        />
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', paddingTop: 12 }}>
        <div role="listbox" aria-label="Files" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <ListRow
            leading={<Tile icon={File} size={28} />}
            title="quarterly-report-final-v3.pdf"
            subtitle="Edited 2 days ago"
            trailing={<span style={{ color: 'var(--xeno-muted)', fontSize: 12 }}>2.1 MB</span>}
            onSelect={() => {}}
          />
          <ListRow
            leading={<Tile icon={Folder} size={28} />}
            title="Assets"
            subtitle="18 items"
            trailing={<span style={{ color: 'var(--xeno-muted)', fontSize: 12 }}>—</span>}
            onSelect={() => {}}
          />
        </div>

        <DataTable
          columns={[
            { key: 'model', header: 'Model' },
            { key: 'params', header: 'Params', align: 'right' },
            { key: 'status', header: 'Status', align: 'right' },
          ]}
          rows={[
            { id: 'a', model: 'xeno-opus', params: '671B', status: 'ready' },
            { id: 'b', model: 'xeno-sonnet', params: '70B', status: 'ready' },
            { id: 'c', model: 'xeno-haiku', params: '8B', status: 'warming' },
          ]}
          getRowKey={(r) => r.id}
        />
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', paddingTop: 12 }}>
        <Table>
          <THead>
            <Tr>
              <Th>Region</Th>
              <Th align="right">Requests</Th>
            </Tr>
          </THead>
          <TBody>
            <Tr><Td>us-east</Td><Td align="right">1,204</Td></Tr>
            <Tr selected><Td>eu-west</Td><Td align="right">982</Td></Tr>
            <Tr><Td>ap-south</Td><Td align="right">311</Td></Tr>
          </TBody>
        </Table>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <MessageBubble role="user" timestamp="2:14 PM">
            How do I center a div with flexbox?
          </MessageBubble>
          <MessageBubble
            role="assistant"
            timestamp="2:14 PM"
            actions={
              <>
                <IconButton icon={Copy} aria-label="Copy" size="sm" />
                <IconButton icon={Refresh} aria-label="Regenerate" size="sm" />
              </>
            }
          >
            Make the parent a flex container and center on both axes:{' '}
            <InlineCode>justify-content: center; align-items: center;</InlineCode>
          </MessageBubble>
        </div>
      </div>
    </section>
  )
}

function MenuDemo() {
  const [open, setOpen] = useState(false)
  const [wrap, setWrap] = useState(true)
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      aria-label="Document actions"
      trigger={
        <Button
          variant="secondary"
          trailingIcon={ChevronDown}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          Actions
        </Button>
      }
    >
      <MenuItem leadingIcon={Copy} shortcut="⌘C" onSelect={() => setOpen(false)}>Copy</MenuItem>
      <MenuItem leadingIcon={Edit} shortcut="⌘E" onSelect={() => setOpen(false)}>Rename</MenuItem>
      <MenuItem leadingIcon={Download} onSelect={() => setOpen(false)}>Download</MenuItem>
      <MenuItem selected={wrap} onSelect={() => setWrap((w) => !w)}>Wrap lines</MenuItem>
      <MenuItem leadingIcon={Share} submenu>Share</MenuItem>
      <MenuItem leadingIcon={Star} disabled>Add to favourites</MenuItem>
      <MenuItem leadingIcon={Trash} variant="danger" shortcut="⌫" onSelect={() => setOpen(false)}>
        Delete
      </MenuItem>
    </Menu>
  )
}

function ModalDemo() {
  const [open, setOpen] = useState(false)
  const [sheet, setSheet] = useState(false)
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <Button variant="primary" onClick={() => setOpen(true)}>Delete project…</Button>
      <Button variant="outline" onClick={() => setSheet(true)}>Open sheet</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Delete project"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => setOpen(false)}>Delete</Button>
          </>
        }
      >
        This permanently removes <strong>xeno-platform</strong> and every release it has published. This
        action cannot be undone.
      </Modal>
      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="Quick settings"
        footer={<Button variant="primary" onClick={() => setSheet(false)}>Done</Button>}
      >
        <p style={{ margin: 0 }}>A sheet shares the dialog’s contract but slides up from the bottom edge.</p>
      </Sheet>
    </div>
  )
}

function SelectorsDemo() {
  const [view, setView] = useState('overview')
  const [range, setRange] = useState('week')
  const [filters, setFilters] = useState<string[]>(['open'])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Tabs
        value={view}
        onValueChange={setView}
        aria-label="Project view"
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'activity', label: 'Activity' },
          { value: 'settings', label: 'Settings', disabled: true },
        ]}
        renderPanel={(v) => (
          <p style={{ margin: 0, color: 'var(--xeno-muted)', fontSize: 14 }}>
            Showing the <strong style={{ color: 'var(--xeno-text)' }}>{v}</strong> panel. Use Arrow / Home / End
            to move.
          </p>
        )}
      />
      <SegmentedControl
        value={range}
        onValueChange={setRange}
        options={[
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
        ]}
      />
      <PillFilter
        value={filters}
        onValueChange={setFilters}
        options={[
          { value: 'open', label: 'Open', count: 12 },
          { value: 'closed', label: 'Closed', count: 30 },
          { value: 'mine', label: 'Assigned to me', count: 4 },
          { value: 'archived', label: 'Archived', disabled: true },
        ]}
      />
    </div>
  )
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Two triggers sharing ONE Reveal: because both panels are the same height, switching between Date and
// Time keeps the region's height constant (no shrink-then-grow), and the panel slides under the active
// field.
function DateTimeDemo() {
  const [month, setMonth] = useState<MonthParts>({ year: 2026, month: 7 })
  const [selected, setSelected] = useState<DateParts | undefined>({ year: 2026, month: 7, day: 15 })
  const [time, setTime] = useState<TimeValue>({ hour: 9, minute: 30, meridiem: 'AM' })
  const [active, setActive] = useState<'date' | 'time' | null>(null)
  const [lastActive, setLastActive] = useState<'date' | 'time'>('date')
  const [offset, setOffset] = useState(0)
  const [panelH, setPanelH] = useState(262)
  const rootRef = useRef<HTMLDivElement>(null)
  const dateBtn = useRef<HTMLButtonElement>(null)
  const timeBtn = useRef<HTMLButtonElement>(null)
  const dateWrapRef = useRef<HTMLDivElement>(null)

  const dateLabel = selected ? `${MONTHS[selected.month]} ${selected.day}, ${selected.year}` : ''
  const timeLabel = `${time.hour}:${String(time.minute).padStart(2, '0')} ${time.meridiem}`

  // Remember the last opened field so its panel stays rendered while the region collapses on close.
  useEffect(() => {
    if (active) setLastActive(active)
  }, [active])

  // Slide the panel under whichever trigger is active.
  useLayoutEffect(() => {
    const btn = active === 'date' ? dateBtn.current : active === 'time' ? timeBtn.current : null
    if (btn) setOffset(btn.offsetLeft)
  }, [active])

  // Lock the shared reveal to the calendar's (natural) height, so the time panel matches it exactly and
  // switching never changes the container size.
  useLayoutEffect(() => {
    if (active === 'date' && dateWrapRef.current) setPanelH(dateWrapRef.current.offsetHeight)
  }, [active, month])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setActive(null)
    }
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setActive(null)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [active])

  const shown = active ?? lastActive
  const toggle = (which: 'date' | 'time'): void => setActive((a) => (a === which ? null : which))

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <button
          ref={dateBtn}
          type="button"
          className="xeno-field-trigger"
          data-open={active === 'date' ? 'true' : 'false'}
          aria-expanded={active === 'date'}
          onClick={() => toggle('date')}
        >
          <span className="xeno-field-label">Date</span>
          <span className="xeno-field-value" data-placeholder={dateLabel ? 'false' : 'true'}>
            {dateLabel || 'Pick a date'}
          </span>
          <span className="xeno-field-chevron" aria-hidden="true">
            <XenoElement decl={ChevronRight} size={14} />
          </span>
        </button>
        <button
          ref={timeBtn}
          type="button"
          className="xeno-field-trigger"
          data-open={active === 'time' ? 'true' : 'false'}
          aria-expanded={active === 'time'}
          onClick={() => toggle('time')}
        >
          <span className="xeno-field-icon" aria-hidden="true">
            <XenoElement decl={Clock} size={16} />
          </span>
          <span className="xeno-field-label">Time</span>
          <span className="xeno-field-value">{timeLabel}</span>
          <span className="xeno-field-chevron" aria-hidden="true">
            <XenoElement decl={ChevronRight} size={14} />
          </span>
        </button>
      </div>

      <Reveal open={active !== null}>
        <div style={{ marginLeft: offset, transition: 'margin-left 220ms cubic-bezier(0.22, 1, 0.36, 1)' }}>
          {shown === 'date' ? (
            <div ref={dateWrapRef}>
              <DatePicker
                month={month}
                {...(selected ? { selected } : {})}
                today={{ year: 2026, month: 7, day: 11 }}
                onMonthChange={setMonth}
                onSelect={(d) => {
                  setSelected(d)
                  setActive(null)
                }}
                onClear={() => {
                  setSelected(undefined)
                  setActive(null)
                }}
              />
            </div>
          ) : (
            <TimePicker value={time} onChange={setTime} style={{ height: panelH }} />
          )}
        </div>
      </Reveal>
    </div>
  )
}

function OverlaysSection() {
  return (
    <section className="xeno panel">
      <div className="panel-head"><h2>Overlays</h2></div>

      <div className="row">
        <span className="tag">Menu · Modal</span>
        <MenuDemo />
        <ModalDemo />
      </div>

      <div className="row">
        <span className="tag">Tooltip</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center' }}>
          <Tooltip content="Appears above" side="top"><Button>Top</Button></Tooltip>
          <Tooltip content="Appears below" side="bottom"><Button>Bottom</Button></Tooltip>
          <Tooltip content="Nudges out left" side="left"><Button>Left</Button></Tooltip>
          <Tooltip content="Nudges out right" side="right"><Button>Right</Button></Tooltip>
          <Tooltip content="Copy link" side="top"><IconButton icon={Link} aria-label="Copy link" /></Tooltip>
        </div>
      </div>

      <div className="row">
        <span className="tag">Tabs · Segmented · Pills</span>
        <div style={{ flex: 1, minWidth: 280 }}><SelectorsDemo /></div>
      </div>

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <span className="tag" style={{ marginTop: 9 }}>Date · Time</span>
        <DateTimeDemo />
      </div>
    </section>
  )
}

function FormsDemo() {
  const [stream, setStream] = useState(true)
  const [sources, setSources] = useState<boolean | 'mixed'>('mixed')
  const [save, setSave] = useState(false)
  const [tone, setTone] = useState('balanced')
  const [layoutView, setLayoutView] = useState('grid')
  return (
    <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <Checkbox checked={stream} label="Streaming answers" onCheckedChange={setStream} />
        <Checkbox checked={sources} label="Include sources" onCheckedChange={(v) => setSources(v)} />
        <Checkbox checked={save} label="Save transcript" onCheckedChange={setSave} />
        <Checkbox checked={false} disabled label="Beta features (locked)" />
      </div>
      <RadioGroup
        name="tone"
        value={tone}
        onValueChange={setTone}
        options={[
          { value: 'precise', label: 'Precise' },
          { value: 'balanced', label: 'Balanced' },
          { value: 'creative', label: 'Creative' },
          { value: 'legacy', label: 'Legacy (unavailable)', disabled: true },
        ]}
      />
      <RadioGroup
        name="view"
        value={layoutView}
        orientation="horizontal"
        onValueChange={setLayoutView}
        options={[
          { value: 'list', label: 'List' },
          { value: 'grid', label: 'Grid' },
        ]}
      />
    </div>
  )
}

function FormsSection() {
  return (
    <section className="xeno panel">
      <div className="panel-head"><h2>Forms</h2></div>
      <div style={{ paddingTop: 12 }}>
        <FormsDemo />
      </div>
    </section>
  )
}

function ModelPickerDemo() {
  const options = [
    { id: 'gpt-4o', label: 'GPT-4o', provider: 'OpenAI' },
    { id: 'o3', label: 'o3', provider: 'OpenAI' },
    { id: 'opus-4', label: 'Claude Opus 4', provider: 'Anthropic' },
    { id: 'sonnet-4', label: 'Claude Sonnet 4', provider: 'Anthropic' },
    { id: 'gemini', label: 'Gemini 2.5 Pro', provider: 'Google' },
    { id: 'local', label: 'Local Llama 3' },
  ]
  const [tray, setTray] = useState('opus-4')
  const [rail, setRail] = useState('gpt-4o')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <ModelPicker layout="tray" options={options} value={tray} onChange={setTray} label="Model" />
      <ModelPicker layout="rail" options={options} value={rail} onChange={setRail} label="Runtime model" />
    </div>
  )
}

function ContentSection() {
  // Remounting the callout is what replays its entrance — the animation runs when the element appears.
  const [calloutKey, setCalloutKey] = useState(0)
  return (
    <section className="xeno panel">
      <div className="panel-head">
        <h2>Content</h2>
        <Button size="sm" variant="ghost" onClick={() => setCalloutKey((k) => k + 1)}>
          Replay callout
        </Button>
      </div>

      <div className="row">
        <span className="tag">CodeBlock</span>
        <div style={{ display: 'grid', gap: 16, maxWidth: 560, flex: 1 }}>
          <CodeBlock language="tsx" code={`export function greet(name: string) {\n  return \`Hello, \${name}\`\n}`} />
          <CodeBlock
            language="bash"
            collapsible
            defaultCollapsed
            code={`pnpm install\npnpm --filter @xenosystem/elements-react build\npnpm test`}
          />
          <CodeBlock
            language="python"
            onRun={() => {}}
            code={`print(sum(range(10)))`}
            output={{ status: 'ok', text: '45' }}
          />
          <CodeBlock
            language="js"
            onRun={() => {}}
            code={`JSON.parse('{ bad }')`}
            output={{ status: 'error', text: 'SyntaxError: Unexpected token b in JSON at position 2' }}
          />
        </div>
      </div>

      <div className="row">
        <span className="tag">Sources</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560, flex: 1 }}>
          <SourceCard
            title="Attention Is All You Need"
            domain="arxiv.org"
            href="https://arxiv.org/abs/1706.03762"
            snippet="The dominant sequence transduction models are based on complex recurrent or convolutional neural networks."
          />
          <SourceCard
            title="Transformer (deep learning architecture)"
            domain="en.wikipedia.org"
            href="https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture)"
          />
          <SourcesDisclosure
            defaultOpen
            sources={[
              {
                title: 'Attention Is All You Need',
                domain: 'arxiv.org',
                href: 'https://arxiv.org/abs/1706.03762',
                snippet: 'Introduces the Transformer, based solely on attention mechanisms.',
              },
              { title: 'The Illustrated Transformer', domain: 'jalammar.github.io', href: 'https://jalammar.github.io/illustrated-transformer/' },
              { title: 'Transformer', domain: 'en.wikipedia.org' },
              { title: 'Language Models are Few-Shot Learners', domain: 'arxiv.org' },
              { title: 'BERT', domain: 'aclanthology.org' },
              { title: 'A Survey of Transformers', domain: 'sciencedirect.com' },
            ]}
          />
        </div>
      </div>

      <div className="row">
        <span className="tag">ModelPicker</span>
        <div style={{ flex: 1, minWidth: 260 }}><ModelPickerDemo /></div>
      </div>

      <div className="row">
        <span className="tag">Markdown chrome</span>
        <div style={{ maxWidth: 560, color: 'var(--xeno-text)', flex: 1 }}>
          <Collapsible summary="Thoughts" defaultOpen>
            Weighing <InlineCode>useMemo</InlineCode> against a plain recompute — the recompute is cheap, so no
            memo.
          </Collapsible>
          <p style={{ marginTop: 16, lineHeight: 1.6 }}>
            Run <InlineCode>npm run build</InlineCode> to emit the bundle. Output streams in live<Caret />
          </p>
          <Callout>A blockquote sets a passage apart in a quiet, muted, italic voice.</Callout>
          <Callout tone="danger" style={{ marginTop: 12 }}>
            Danger tone — the rule and the glyph turn to <InlineCode>--xeno-danger</InlineCode>, and the
            alert mark arrives on its own.
          </Callout>
          <Callout icon={Info} style={{ marginTop: 12 }}>
            A default callout takes a glyph only when asked — an aside that stamps a mark on itself has
            stopped being an aside.
          </Callout>
          <Callout key={calloutKey} tone="danger" enter style={{ marginTop: 12 }}>
            Entrance: the rule draws down from the top while the text arrives behind it. Use{' '}
            <InlineCode>Replay callout</InlineCode> above to see it again.
          </Callout>
        </div>
      </div>
    </section>
  )
}

function SidebarDemo() {
  const [open, setOpen] = useState(true)
  return (
    <div
      style={{
        position: 'relative',
        // A transform makes this the containing block for the Sidebar's position:fixed panel,
        // so the nav stays inside the demo card instead of pinning to the viewport.
        transform: 'translateZ(0)',
        minHeight: 460,
        overflow: 'hidden',
        background: 'var(--xeno-canvas)',
        border: '1px solid var(--xeno-border)',
        borderRadius: 12,
      }}
    >
      <Sidebar
        open={open}
        onOpenChange={setOpen}
        brand="XENO"
        activeId="home"
        onSelect={() => {}}
        searchPlaceholder="Search projects"
        items={[
          { id: 'home', label: 'Home', icon: Home },
          { id: 'starred', label: 'Starred', icon: Star },
          { id: 'messages', label: 'Messages', icon: Message },
          { id: 'settings', label: 'Settings', icon: Gear },
        ]}
        sections={[
          {
            heading: 'Recents',
            items: [
              { id: 'brief', label: 'Launch brief', icon: Clock },
              { id: 'notes', label: 'Field notes', icon: File },
            ],
          },
        ]}
        footer={<div style={{ color: 'var(--xeno-muted)', fontSize: 13 }}>emilian@bnkrsys.com</div>}
      />
      <div style={{ position: 'absolute', right: 16, top: 16 }}>
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : 'Open'} sidebar
        </Button>
      </div>
    </div>
  )
}

function NavLayoutSection() {
  return (
    <section className="xeno panel">
      <div className="panel-head"><h2>Nav · Layout</h2></div>

      <div style={{ paddingTop: 12 }}>
        <SidebarDemo />
      </div>

      <div
        style={{
          display: 'flex',
          height: 300,
          marginTop: 20,
          background: 'var(--xeno-canvas)',
          border: '1px solid var(--xeno-border)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <ResizablePanel side="right" defaultSize={220} min={160} max={340} handleLabel="Resize explorer">
          <nav style={{ padding: 16 }}>
            <div
              style={{
                color: 'var(--xeno-muted)',
                fontSize: 11,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                marginBottom: 10,
              }}
            >
              Explorer
            </div>
            {['Overview', 'Research trace', 'Files', 'Settings'].map((label) => (
              <div key={label} style={{ padding: '6px 8px', borderRadius: 6, color: 'var(--xeno-text)' }}>
                {label}
              </div>
            ))}
          </nav>
        </ResizablePanel>
        <main style={{ flex: 1, minWidth: 0, padding: 24, color: 'var(--xeno-text)' }}>
          <h3 style={{ margin: '0 0 8px' }}>ResizablePanel</h3>
          <p style={{ color: 'var(--xeno-muted)', margin: 0, lineHeight: 1.5 }}>
            Drag either divider — or focus it and press ←/→, Home/End — to resize.
          </p>
        </main>
        <ResizablePanel side="left" defaultSize={240} min={200} max={380} handleLabel="Resize inspector">
          <aside style={{ padding: 16, color: 'var(--xeno-text)' }}>
            <div
              style={{
                color: 'var(--xeno-muted)',
                fontSize: 11,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                marginBottom: 10,
              }}
            >
              Inspector
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <div>Type — panel</div>
              <div>Min — 200px</div>
              <div>Max — 380px</div>
            </div>
          </aside>
        </ResizablePanel>
      </div>
    </section>
  )
}

function StatusSection() {
  return (
    <section className="xeno panel">
      <div className="panel-head"><h2>Status</h2></div>

      <div className="row">
        <span className="tag">Cube · Spinner · Indicator</span>
        <ThinkingCube state="thinking" size={24} />
        <ThinkingCube state="settled" size={24} />
        <Spinner />
        <Spinner size={24} label="Loading results" />
        <StatusIndicator tone="neutral">Idle</StatusIndicator>
        <StatusIndicator tone="active">Streaming</StatusIndicator>
        <StatusIndicator tone="success">Deployed</StatusIndicator>
        <StatusIndicator tone="danger">Failed</StatusIndicator>
      </div>

      <div className="row">
        <span className="tag">Progress</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 320, width: '100%' }}>
          <ProgressBar value={0.25} />
          <ProgressBar value={0.6} label="Uploading" />
          <ProgressBar value={1} label="Complete" />
          <ProgressBar value={null} label="Indexing the repository" />
        </div>
      </div>

      <div className="row">
        <span className="tag">Timeline</span>
        <StepTimeline
          steps={[
            { label: 'Parse the request', status: 'done', time: '0:01' },
            { label: 'Search the corpus', status: 'done', time: '0:03' },
            { label: 'Synthesize an answer', status: 'active', time: '0:07' },
            { label: 'Cite the sources', status: 'pending' },
          ]}
        />
      </div>
    </section>
  )
}

function Gallery() {
  return (
    <>
      <ContainersSection />
      <OverlaysSection />
      <FormsSection />
      <ContentSection />
      <NavLayoutSection />
      <StatusSection />
    </>
  )
}

const clampN = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/**
 * LiquidToggle — the gooey effect on an element big enough to read it: a 20px knob whose liquid surface
 * rubber-slides and trails a droplet between off/on (liquid-gooey `effect="move"`). Preview-only (JS +
 * SVG filter). The knob content is transparent, so the LIQUID is the knob — one melting shape.
 *
 * The blur is deliberately SMALLER than the knob's corner radius: the gooey threshold rounds any corner
 * tighter than the blur, so a big blur turns the knob into a circle no matter what radius it is given.
 */
function LiquidToggle({ label }: { label: string }) {
  const [on, setOn] = useState(false)
  const TRAVEL = 34 // liquid box 54 (68 − 2px border − 12px inset) − 20px knob
  return (
    <label className="switch-row">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        className="lqtoggle"
        data-on={on ? 'true' : 'false'}
        onClick={() => setOn((v) => !v)}
      >
        <Liquid blur={3} contrast={20} fill="#f4f4f6" className="lqtoggle-liquid">
          <Liquid.Item effect="move" move={{ springiness: 0.5, wobble: 0.55, stretch: 0.5, trail: 0.5 }}>
            <div className="lqtoggle-knob" style={{ transform: `translateX(${on ? TRAVEL : 0}px)` }} />
          </Liquid.Item>
        </Liquid>
      </button>
      <span>{label} {on ? 'on' : 'off'}</span>
    </label>
  )
}

/** A controlled slider (drag + keyboard) with a rounded-square thumb — on-grammar and artifact-free.
 *
 * The goo is liquid-gooey's own `move` physics (`springiness` + `trail`): the liquid springs after the
 * thumb, stretches into a droplet when you drag fast, snaps, and merges back when it catches up. That
 * separation-and-merge is the thing a CSS squash-and-stretch cannot fake — a scaled rectangle is always
 * one shape, and the goo's whole point is that it briefly is not.
 *
 * The element under the liquid is transparent and stays exactly under the pointer; ALL of the lag lives
 * in the liquid. That distinction matters: a thumb whose own position is eased comes away from the fill
 * on a fast drag, which reads as a bug, not as physics. */
function GooeySlider({
  value,
  min,
  max,
  step,
  onChange,
  ariaLabel,
}: {
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  ariaLabel: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(200)
  /**
   * Geometry lifted from liquid-gooey's own slider demo, which does not have this problem. The lesson
   * there is not in the physics — it is in the BOX. Their container is 240x80 for a 24px thumb, and the
   * rail is inset 14px from each end: the thumb runs the full length of the RAIL (max travel is exactly
   * railWidth − thumb, so it lands flush on the end), and the container keeps a whole thumb-width of
   * empty room beyond that, plus 28px above and below, purely for the liquid to spill into.
   *
   * That is the part I had wrong. I kept shrinking the travel to hold the goo in, in a box only 4px
   * wider and 2px taller than the thumb — there was simply nowhere for a blob that is bigger than its
   * element to go, so it went over the rail. Give it the room and the thumb can sit flush again.
   * Ratios kept: inset ≈ 0.56 x thumb, box ≈ 2.2 x thumb tall.
   */
  const THUMB = 18
  const RAIL_INSET = 10
  const SPAN = Math.max(0, w - RAIL_INSET * 2 - THUMB)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pct = (value - min) / (max - min)
  // Travel only — the thumb's own `left` already sits it at the start of the rail, as in the demo.
  const x = pct * SPAN

  const setFromClientX = (clientX: number): void => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    // Same geometry as the thumb, or the pointer and the thumb disagree about where a value sits.
    const p = clampN(
      (clientX - rect.left - RAIL_INSET - THUMB / 2) /
        Math.max(1, rect.width - RAIL_INSET * 2 - THUMB),
      0,
      1,
    )
    const snapped = Math.round((min + p * (max - min)) / step) * step
    onChange(clampN(Number(snapped.toFixed(4)), min, max))
  }

  return (
    <div
      ref={ref}
      className="gooey-slider"
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        setFromClientX(e.clientX)
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) setFromClientX(e.clientX)
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault()
          onChange(clampN(value - step, min, max))
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault()
          onChange(clampN(value + step, min, max))
        } else if (e.key === 'Home') {
          e.preventDefault()
          onChange(min)
        } else if (e.key === 'End') {
          e.preventDefault()
          onChange(max)
        }
      }}
    >
      <div className="gooey-track" />
      {/* The fill ends at the thumb's CENTRE, derived from the very same `x`. Sizing it as a percentage
          of the track instead made it a second, independent formula for the same position — one using
          the live element width, the other a measured copy of it — so the two could disagree whenever
          the measurement was a beat stale, and the fill would come up short of the thumb. */}
      <div className="gooey-fill" style={{ width: `${x + THUMB / 2}px` }} />
      {/* The goo is liquid-gooey's own `move` physics, not a CSS approximation of them: the blob springs
          after the thumb and leaves a droplet that stretches, snaps and merges back. The thumb itself is
          transparent — the LIQUID is the thumb. */}
      {/* blur 3, not 5. The gooey threshold rounds off any corner TIGHTER than the blur, so the blur is
          a FLOOR under the corner radius however square the element is declared — at 5 on an 18px thumb
          that floor was 28% of the whole width, and the square could not survive it. 3 is the same
          value the toggle's knob uses, and its corners hold. */}
      <Liquid blur={3} contrast={18} fill="#f4f4f6" className="gooey-liquid">
        {/* `wobble` is what decides whether the liquid STOPS. It is how far the surface overshoots on
            arrival, and it defaults to 0.5 — so leaving it out (as the usual snippet does) means the
            blob sails past the thumb every time it lands, and at the ends of the track it sails past
            the track itself. Near zero here: on a slider the thumb has hard stops, and liquid that
            keeps going after them reads as broken rather than as physics.
            `springiness` is raised to match — 1 is near-instant, 0 is syrup — so the liquid chases the
            pointer closely and only the tail is allowed to lag. */}
        <Liquid.Item effect="move" move={{ springiness: 0.82, wobble: 0.08, stretch: 0.3, trail: 0.35 }}>
          <div className="gooey-thumb" style={{ transform: `translateX(${x}px)` }} />
        </Liquid.Item>
      </Liquid>
    </div>
  )
}

function GlyphGrid() {
  const [size, setSize] = useState(28)
  const [strokeWidth, setStrokeWidth] = useState(1.75)
  const [selections, setSelections] = useState<Record<string, Selection>>({})
  const stateful = useMemo(() => DECLS.filter((d) => d.contract.axes.length > 0), [])

  const toggle = (d: ElementDeclaration) => {
    if (!d.contract.axes.includes('selection')) return
    setSelections((s) => ({ ...s, [d.id]: nextSelection[s[d.id] ?? 'off'] }))
  }

  return (
    <>
      <div className="masthead">
        <div className="title">
          <h2>{DECLS.length} glyphs</h2>
          <p className="sub">Each drawn by <code>&lt;XenoElement&gt;</code> from its declaration. Click a stateful one to toggle selection.</p>
        </div>
        <div className="controls">
          <label>
            <span>Size <b>{size}px</b></span>
            <GooeySlider value={size} min={16} max={64} step={1} onChange={setSize} ariaLabel="Size" />
          </label>
          <label>
            <span>Stroke <b>{strokeWidth.toFixed(2)}</b></span>
            <GooeySlider value={strokeWidth} min={1} max={2.5} step={0.05} onChange={setStrokeWidth} ariaLabel="Stroke width" />
          </label>
        </div>
      </div>

      <section className="grid">
        {DECLS.map((d) => {
          const sel = selections[d.id] ?? 'off'
          const isStateful = d.contract.axes.includes('selection')
          return (
            <button
              key={d.id}
              className={`cell xeno-icon-hover${isStateful ? ' stateful' : ''}${sel === 'on' ? ' on' : ''}`}
              onClick={() => toggle(d)}
              title={isStateful ? `${shortId(d.id)} — selection: ${sel}` : shortId(d.id)}
              type="button"
            >
              <span className="swatch">
                <XenoElement decl={d} size={size} strokeWidth={strokeWidth} state={{ selection: sel }} />
              </span>
              <span className="label">{shortId(d.id)}</span>
              {isStateful && <span className="badge">{sel}</span>}
            </button>
          )
        })}
      </section>
    </>
  )
}

function Playground() {
  /**
   * The one thing `.xeno-scroll-wake` needs from the app: an attribute that says the page is moving.
   * A stylesheet can observe hover but not activity, and for the document element hover is useless —
   * it is true whenever the pointer is anywhere in the window, which would leave the page's bar
   * permanently on. So the bar is gated on this instead: set on scroll, dropped 600ms after the last
   * event. Longer than the panels' 500ms because a page is scrolled in bursts, and a bar that blinks
   * out between two flicks of the wheel is worse than one that lingers.
   */
  useEffect(() => {
    const root = document.documentElement
    let idle: ReturnType<typeof setTimeout> | undefined
    const onScroll = (): void => {
      root.setAttribute('data-scrolling', '')
      clearTimeout(idle)
      idle = setTimeout(() => root.removeAttribute('data-scrolling'), 600)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      clearTimeout(idle)
      root.removeAttribute('data-scrolling')
    }
  }, [])

  /*
   * The chrome axis is set on the ROOT, not per section, because it is a property of the surface an
   * element renders under — every panel and dialog on the page has to answer to one construction at a
   * time or the comparison is meaningless. `separated` is the default (DESIGN_SYSTEM §"Panel
   * Structure" requires it); `unified` is the opt-in that preserves how this set rendered before.
   */
  const [chrome, setChrome] = useState<'industrial' | 'soft' | 'compare'>('industrial')
  useEffect(() => {
    if (chrome === 'compare') {
      document.documentElement.removeAttribute('data-style')
      return
    }
    document.documentElement.setAttribute('data-style', chrome)
    return () => document.documentElement.removeAttribute('data-style')
  }, [chrome])

  /*
   * COMPARE renders the same tree twice, each half under its own `data-style`. It is the only way
   * either owner can see that a change to their construction did not move the other one — and it is
   * cheap precisely because both looks come from ONE DOM. If this needed two component trees, the
   * axis would not be doing its job.
   *
   * It also proves the axis is scoped correctly: the wrapper carries the attribute, the nested
   * `.xeno` sections inside must NOT reset it. When that was broken, both halves rendered identically
   * and the bug was invisible in the single-chrome views.
   */
  const body = (
    <>
      <ControlsShowcase />
      <Gallery />
    </>
  )

  return (
    <div className="app xeno" {...(chrome === 'compare' ? {} : { 'data-style': chrome })}>
      <header className="app-head">
        <h1>XENO Elements</h1>
        <p className="sub">State Playground — controls, Tier-2 elements, and glyphs rendered from declarations + tokens. No hand-written SVG or CSS-in-JS.</p>
        <div className="chrome-switch">
          <SegmentedControl
            value={chrome}
            onValueChange={(v) => setChrome(v as typeof chrome)}
            options={[
              { value: 'industrial', label: 'Industrial' },
              { value: 'soft', label: 'Soft' },
              { value: 'compare', label: 'Compare' },
            ]}
            aria-label="Chrome construction"
          />
          <span className="chrome-note">
            {chrome === 'industrial'
              ? 'separated — plates on a page-background shell, 2px gaps, no shadow'
              : chrome === 'soft'
                ? 'unified — one clipped surface, hairline dividers, soft shadow'
                : 'both, from one DOM — check your change did not move the other side'}
          </span>
        </div>
      </header>

      {chrome === 'compare' ? (
        <div className="chrome-compare">
          <div className="chrome-compare-col" data-style="industrial">
            <div className="chrome-compare-tag">Industrial · separated</div>
            {body}
          </div>
          <div className="chrome-compare-col" data-style="soft">
            <div className="chrome-compare-tag">Soft · unified</div>
            {body}
          </div>
        </div>
      ) : (
        body
      )}
      <GlyphGrid />
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Playground />
  </StrictMode>,
)
