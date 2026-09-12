// src/components/platform/PlatformCommandPalette.tsx
import { useEffect, useMemo, useRef, useState } from "react";

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/createLucideIcon.js
import { forwardRef as forwardRef2, createElement as createElement2 } from "react";

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/shared/src/utils.js
var toKebabCase = (string) => string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
var mergeClasses = (...classes) => classes.filter((className, index, array) => {
  return Boolean(className) && className.trim() !== "" && array.indexOf(className) === index;
}).join(" ").trim();

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/Icon.js
import { forwardRef, createElement } from "react";

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/defaultAttributes.js
var defaultAttributes = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round"
};

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/Icon.js
var Icon = forwardRef(
  ({
    color = "currentColor",
    size = 24,
    strokeWidth = 2,
    absoluteStrokeWidth,
    className = "",
    children,
    iconNode,
    ...rest
  }, ref) => {
    return createElement(
      "svg",
      {
        ref,
        ...defaultAttributes,
        width: size,
        height: size,
        stroke: color,
        strokeWidth: absoluteStrokeWidth ? Number(strokeWidth) * 24 / Number(size) : strokeWidth,
        className: mergeClasses("lucide", className),
        ...rest
      },
      [
        ...iconNode.map(([tag, attrs]) => createElement(tag, attrs)),
        ...Array.isArray(children) ? children : [children]
      ]
    );
  }
);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/createLucideIcon.js
var createLucideIcon = (iconName, iconNode) => {
  const Component = forwardRef2(
    ({ className, ...props }, ref) => createElement2(Icon, {
      ref,
      iconNode,
      className: mergeClasses(`lucide-${toKebabCase(iconName)}`, className),
      ...props
    })
  );
  Component.displayName = `${iconName}`;
  return Component;
};

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/bell.js
var __iconNode = [
  ["path", { d: "M10.268 21a2 2 0 0 0 3.464 0", key: "vwvbt9" }],
  [
    "path",
    {
      d: "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326",
      key: "11g9vi"
    }
  ]
];
var Bell = createLucideIcon("Bell", __iconNode);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/building-2.js
var __iconNode2 = [
  ["path", { d: "M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z", key: "1b4qmf" }],
  ["path", { d: "M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2", key: "i71pzd" }],
  ["path", { d: "M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2", key: "10jefs" }],
  ["path", { d: "M10 6h4", key: "1itunk" }],
  ["path", { d: "M10 10h4", key: "tcdvrf" }],
  ["path", { d: "M10 14h4", key: "kelpxr" }],
  ["path", { d: "M10 18h4", key: "1ulq68" }]
];
var Building2 = createLucideIcon("Building2", __iconNode2);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/circle-user-round.js
var __iconNode3 = [
  ["path", { d: "M18 20a6 6 0 0 0-12 0", key: "1qehca" }],
  ["circle", { cx: "12", cy: "10", r: "4", key: "1h16sb" }],
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }]
];
var CircleUserRound = createLucideIcon("CircleUserRound", __iconNode3);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/command.js
var __iconNode4 = [
  [
    "path",
    { d: "M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3", key: "11bfej" }
  ]
];
var Command = createLucideIcon("Command", __iconNode4);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/credit-card.js
var __iconNode5 = [
  ["rect", { width: "20", height: "14", x: "2", y: "5", rx: "2", key: "ynyp8z" }],
  ["line", { x1: "2", x2: "22", y1: "10", y2: "10", key: "1b3vmo" }]
];
var CreditCard = createLucideIcon("CreditCard", __iconNode5);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/folder-kanban.js
var __iconNode6 = [
  [
    "path",
    {
      d: "M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z",
      key: "1fr9dc"
    }
  ],
  ["path", { d: "M8 10v4", key: "tgpxqk" }],
  ["path", { d: "M12 10v2", key: "hh53o1" }],
  ["path", { d: "M16 10v6", key: "1d6xys" }]
];
var FolderKanban = createLucideIcon("FolderKanban", __iconNode6);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/gauge.js
var __iconNode7 = [
  ["path", { d: "m12 14 4-4", key: "9kzdfg" }],
  ["path", { d: "M3.34 19a10 10 0 1 1 17.32 0", key: "19p75a" }]
];
var Gauge = createLucideIcon("Gauge", __iconNode7);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/plug.js
var __iconNode8 = [
  ["path", { d: "M12 22v-5", key: "1ega77" }],
  ["path", { d: "M9 8V2", key: "14iosj" }],
  ["path", { d: "M15 8V2", key: "18g5xt" }],
  ["path", { d: "M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z", key: "osxo6l" }]
];
var Plug = createLucideIcon("Plug", __iconNode8);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/search.js
var __iconNode9 = [
  ["circle", { cx: "11", cy: "11", r: "8", key: "4ej97u" }],
  ["path", { d: "m21 21-4.3-4.3", key: "1qie3q" }]
];
var Search = createLucideIcon("Search", __iconNode9);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/settings.js
var __iconNode10 = [
  [
    "path",
    {
      d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
      key: "1qme2f"
    }
  ],
  ["circle", { cx: "12", cy: "12", r: "3", key: "1v7zrd" }]
];
var Settings = createLucideIcon("Settings", __iconNode10);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/shield-check.js
var __iconNode11 = [
  [
    "path",
    {
      d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
      key: "oel41y"
    }
  ],
  ["path", { d: "m9 12 2 2 4-4", key: "dzmm74" }]
];
var ShieldCheck = createLucideIcon("ShieldCheck", __iconNode11);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/users.js
var __iconNode12 = [
  ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", key: "1yyitq" }],
  ["circle", { cx: "9", cy: "7", r: "4", key: "nufk8" }],
  ["path", { d: "M22 21v-2a4 4 0 0 0-3-3.87", key: "kshegd" }],
  ["path", { d: "M16 3.13a4 4 0 0 1 0 7.75", key: "1da9ce" }]
];
var Users = createLucideIcon("Users", __iconNode12);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/x.js
var __iconNode13 = [
  ["path", { d: "M18 6 6 18", key: "1bl5f8" }],
  ["path", { d: "m6 6 12 12", key: "d8bk6v" }]
];
var X = createLucideIcon("X", __iconNode13);

// src/platform/platformCommands.ts
var platformCommands = [
  { id: "dashboard.open", capabilityId: "platform.dashboard.open", label: "Open dashboard", description: "Account and workspace overview", group: "Navigate", keywords: ["home", "overview"], path: "/overview", icon: Gauge },
  { id: "search.open", capabilityId: "platform.search.open", label: "Search XENO", description: "Search conversations and platform resources", group: "Navigate", keywords: ["find", "command"], path: "/overview/chat/search", icon: Search },
  { id: "notifications.open", capabilityId: "platform.notifications.open", label: "Open notifications", description: "Account and workspace signals", group: "Navigate", keywords: ["activity", "inbox"], path: "/overview/notifications", icon: Bell },
  { id: "account.profile", capabilityId: "platform.account.open_profile", label: "Open profile", description: "Identity and public account details", group: "Account", keywords: ["avatar", "name", "email"], path: "/overview/profile", icon: CircleUserRound },
  { id: "account.settings", capabilityId: "platform.account.open_settings", label: "Open account settings", description: "Preferences and account security", group: "Account", keywords: ["preferences", "password"], path: "/overview/settings", icon: Settings },
  { id: "workspace.members", capabilityId: "platform.workspace.open_members", label: "Manage workspace members", description: "Members, roles, and invitations", group: "Workspace", keywords: ["team", "invite", "roles"], path: "/overview/team", icon: Users },
  { id: "workspace.teams", capabilityId: "platform.workspace.open_teams", label: "Manage operational teams", description: "Teams and shared project assignments", group: "Workspace", keywords: ["agents", "team", "fleet", "projects"], path: "/overview/teams", icon: Users },
  { id: "workspace.security", capabilityId: "platform.workspace.open_security", label: "Review workspace security", description: "Backed controls and capability availability", group: "Workspace", keywords: ["sso", "scim", "sessions"], path: "/overview/team/security", icon: ShieldCheck },
  { id: "integrations.open", capabilityId: "platform.integrations.open", label: "Open integrations", description: "Connection catalogue and availability", group: "Workspace", keywords: ["apps", "connections", "mcp"], path: "/overview/integrations", icon: Plug },
  { id: "billing.open", capabilityId: "platform.billing.open", label: "Open billing", description: "Plan, credits, and entitlements", group: "Account", keywords: ["plan", "usage", "payment"], path: "/overview/billing", icon: CreditCard }
];
var platformCapabilities = [{
  id: "platform.app.status",
  label: "Read platform status",
  description: "Hosted surface and current workspace status",
  kind: "read"
}, ...platformCommands.map(({ capabilityId, label, description, path }) => ({
  id: capabilityId,
  label,
  description,
  kind: "navigation",
  path
}))];

// fixture:resources
async function listWorkspaces() {
  return { workspaces: [] };
}
async function listProjects() {
  return { projects: [] };
}

// src/components/platform/PlatformCommandPalette.tsx
import { jsx, jsxs } from "react/jsx-runtime";
var PlatformCommandPalette = ({ open, onClose, onNavigate }) => {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [group, setGroup] = useState("All");
  const [resources, setResources] = useState([]);
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    return [...resources, ...platformCommands].filter((item) => {
      if (group !== "All" && (group === "Resources" ? !item.id.startsWith("resource.") : item.group !== group)) return false;
      return !term || [item.label, item.description, item.group, ...item.keywords].join(" ").toLowerCase().includes(term);
    });
  }, [group, query, resources]);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    const dialog = dialogRef.current;
    setQuery("");
    setGroup("All");
    setActive(0);
    inputRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected && (document.activeElement === document.body || dialog?.contains(document.activeElement))) {
        opener.focus();
      }
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void Promise.all([listWorkspaces(), listProjects()]).then(([workspaceResult, projectResult]) => {
      if (!alive) return;
      setResources([
        ...projectResult.projects.map((project) => ({ id: `resource.project.${project.id}`, capabilityId: "platform.project.open", label: project.name, description: project.description || "Persisted project", group: "Navigate", keywords: ["project", "resource"], path: `/overview/projects/${project.id}`, icon: FolderKanban })),
        ...workspaceResult.workspaces.map((workspace) => ({ id: `resource.workspace.${workspace.id}`, capabilityId: "platform.workspace.open", label: workspace.name, description: `${workspace.workspace_type} workspace`, group: "Workspace", keywords: ["workspace", "team"], path: "/overview/team", icon: Building2 }))
      ]);
    }).catch(() => {
      if (alive) setResources([]);
    });
    return () => {
      alive = false;
    };
  }, [open]);
  useEffect(() => {
    if (active >= results.length) setActive(Math.max(0, results.length - 1));
  }, [active, results.length]);
  if (!open) return null;
  const choose = (path) => {
    onNavigate(path);
    onClose();
  };
  return /* @__PURE__ */ jsx("div", { className: "xeno-command-backdrop", role: "presentation", onMouseDown: (event) => {
    if (event.target === event.currentTarget) onClose();
  }, children: /* @__PURE__ */ jsxs(
    "section",
    {
      ref: dialogRef,
      className: "xeno-command-dialog",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "XENO command palette",
      onKeyDown: (event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          return;
        }
        if (event.key === "Tab") {
          const controls = [...event.currentTarget.querySelectorAll("input:not(:disabled), button:not(:disabled)")];
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
          return;
        }
        if (event.target !== inputRef.current || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActive((index) => Math.min(results.length - 1, index + 1));
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setActive((index) => Math.max(0, index - 1));
        }
        if (event.key === "Enter" && results[active]) {
          event.preventDefault();
          choose(results[active].path);
        }
      },
      children: [
        /* @__PURE__ */ jsxs("div", { className: "xeno-command-input-row", children: [
          /* @__PURE__ */ jsx(Search, { size: 18 }),
          /* @__PURE__ */ jsx("input", { ref: inputRef, value: query, onChange: (event) => {
            setQuery(event.target.value);
            setActive(0);
          }, placeholder: "Search anything or enter a command", "aria-label": "Search commands" }),
          /* @__PURE__ */ jsx("kbd", { children: "Return" }),
          /* @__PURE__ */ jsx("button", { type: "button", onClick: onClose, "aria-label": "Close command palette", children: /* @__PURE__ */ jsx(X, { size: 17 }) })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "xeno-command-groups", "aria-label": "Command categories", children: [
          ["All", "Resources", "Navigate", "Workspace", "Account"].map((item) => /* @__PURE__ */ jsx("button", { type: "button", className: group === item ? "is-active" : "", onClick: () => {
            setGroup(item);
            setActive(0);
          }, children: item }, item)),
          /* @__PURE__ */ jsxs("span", { children: [
            results.length,
            " results"
          ] })
        ] }),
        /* @__PURE__ */ jsx("div", { className: "xeno-command-results", role: "listbox", "aria-label": "Commands", children: results.length ? results.map((item, index) => {
          const Icon2 = item.icon;
          return /* @__PURE__ */ jsxs("button", { type: "button", role: "option", "aria-selected": index === active, className: index === active ? "is-active" : "", onMouseEnter: () => setActive(index), onClick: () => choose(item.path), children: [
            /* @__PURE__ */ jsx("span", { className: "xeno-command-icon", children: /* @__PURE__ */ jsx(Icon2, { size: 17 }) }),
            /* @__PURE__ */ jsxs("span", { children: [
              /* @__PURE__ */ jsx("strong", { children: item.label }),
              /* @__PURE__ */ jsx("small", { children: item.description })
            ] }),
            /* @__PURE__ */ jsx("em", { children: item.group }),
            /* @__PURE__ */ jsx("kbd", { children: index + 1 })
          ] }, item.id);
        }) : /* @__PURE__ */ jsxs("div", { className: "xeno-command-empty", children: [
          /* @__PURE__ */ jsx(Command, { size: 21 }),
          /* @__PURE__ */ jsx("strong", { children: "No matching command" }),
          /* @__PURE__ */ jsx("span", { children: "Try account, workspace, billing, or integrations." })
        ] }) }),
        /* @__PURE__ */ jsxs("footer", { children: [
          /* @__PURE__ */ jsxs("span", { children: [
            /* @__PURE__ */ jsx("kbd", { children: "\u2191" }),
            /* @__PURE__ */ jsx("kbd", { children: "\u2193" }),
            " Navigate"
          ] }),
          /* @__PURE__ */ jsxs("span", { children: [
            /* @__PURE__ */ jsx("kbd", { children: "Enter" }),
            " Open"
          ] }),
          /* @__PURE__ */ jsxs("span", { children: [
            /* @__PURE__ */ jsx("kbd", { children: "Esc" }),
            " Close"
          ] })
        ] })
      ]
    }
  ) });
};
var PlatformCommandPalette_default = PlatformCommandPalette;
export {
  PlatformCommandPalette_default as default
};
/*! Bundled license information:

lucide-react/dist/esm/shared/src/utils.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/defaultAttributes.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/Icon.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/createLucideIcon.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/bell.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/building-2.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/circle-user-round.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/command.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/credit-card.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/folder-kanban.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/gauge.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/plug.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/search.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/settings.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/shield-check.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/users.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/x.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/lucide-react.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)
*/
