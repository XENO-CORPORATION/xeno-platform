/**
 * `?outline=1` — see the chat's containers.
 *
 * A development aid for the component adoption, and it earns its place in the repo rather than living
 * in a console snippet: the question it answers — which control is the library's and which is still
 * hand-written — is the one being asked on every pass of this work, and answering it by pasting
 * JavaScript into a devtools console means answering it slightly differently every time.
 *
 * Pure CSS, so it survives a re-render, follows the layout as it reflows, and costs nothing when the
 * flag is off: the stylesheet is not rendered at all.
 *
 * Colours are the roles, not decoration:
 *
 *   red      the chat shell — everything to the LEFT of this line is the Overview taskbar, not chat
 *   yellow   the transcript scroller
 *   green    the composer
 *   cyan     a message bubble
 *   orange   a code block
 *   purple   a message action bar
 *   pink     a control that is now the library's `IconButton`
 *   blue     an open menu or popover
 *
 * `outline` rather than `border`, deliberately: a border joins the box model and moves the layout it
 * is meant to describe. An outline is drawn over the top and changes nothing.
 */
export const isOutlineDebugOn = (): boolean => {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('outline') === '1';
};

const ROLES: readonly (readonly [string, string, string])[] = [
  ['.chat-themed', '#ff3b30', 'chat shell'],
  ['.hide-scrollbar.scrollbar-thin', '#ffcc00', 'transcript'],
  ['[data-chat-composer-shell], [data-conversation-composer-frame]', '#34c759', 'composer'],
  ['.chat-message-bubble', '#00c7be', 'message'],
  ['.code-block-container', '#ff9500', 'code block'],
  ['.action-buttons', '#af52de', 'action bar'],
  ['.xeno-icon-btn', '#ff2d55', 'IconButton'],
  ['[role="menu"], .chat-history-popover', '#0a84ff', 'menu'],
];

export const OUTLINE_DEBUG_CSS = ROLES.map(
  ([selector, colour, label]) => `
  ${selector} {
    outline: 2px solid ${colour} !important;
    outline-offset: -2px !important;
    background-image: linear-gradient(${colour}14, ${colour}14) !important;
  }
  ${selector.split(',')[0]}::after {
    content: '${label}';
    position: absolute;
    top: 0;
    left: 0;
    transform: translateY(-100%);
    z-index: 2147483000;
    background: ${colour};
    color: #000;
    font: 700 10px/1.4 ui-monospace, monospace;
    padding: 1px 5px;
    border-radius: 3px;
    pointer-events: none;
    white-space: nowrap;
  }`,
).join('\n');
