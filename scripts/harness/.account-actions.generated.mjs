// src/components/account/ProjectsPage.tsx
import { useCallback as useCallback3, useEffect as useEffect4, useMemo, useRef as useRef5, useState as useState3 } from "react";

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

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/archive.js
var __iconNode = [
  ["rect", { width: "20", height: "5", x: "2", y: "3", rx: "1", key: "1wp1u1" }],
  ["path", { d: "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8", key: "1s80jp" }],
  ["path", { d: "M10 12h4", key: "a56b0p" }]
];
var Archive = createLucideIcon("Archive", __iconNode);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/bell.js
var __iconNode2 = [
  ["path", { d: "M10.268 21a2 2 0 0 0 3.464 0", key: "vwvbt9" }],
  [
    "path",
    {
      d: "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326",
      key: "11g9vi"
    }
  ]
];
var Bell = createLucideIcon("Bell", __iconNode2);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/calendar-days.js
var __iconNode3 = [
  ["path", { d: "M8 2v4", key: "1cmpym" }],
  ["path", { d: "M16 2v4", key: "4m81vk" }],
  ["rect", { width: "18", height: "18", x: "3", y: "4", rx: "2", key: "1hopcy" }],
  ["path", { d: "M3 10h18", key: "8toen8" }],
  ["path", { d: "M8 14h.01", key: "6423bh" }],
  ["path", { d: "M12 14h.01", key: "1etili" }],
  ["path", { d: "M16 14h.01", key: "1gbofw" }],
  ["path", { d: "M8 18h.01", key: "lrp35t" }],
  ["path", { d: "M12 18h.01", key: "mhygvu" }],
  ["path", { d: "M16 18h.01", key: "kzsmim" }]
];
var CalendarDays = createLucideIcon("CalendarDays", __iconNode3);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/check.js
var __iconNode4 = [["path", { d: "M20 6 9 17l-5-5", key: "1gmf2c" }]];
var Check = createLucideIcon("Check", __iconNode4);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/circle-alert.js
var __iconNode5 = [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["line", { x1: "12", x2: "12", y1: "8", y2: "12", key: "1pkeuh" }],
  ["line", { x1: "12", x2: "12.01", y1: "16", y2: "16", key: "4dfq90" }]
];
var CircleAlert = createLucideIcon("CircleAlert", __iconNode5);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/credit-card.js
var __iconNode6 = [
  ["rect", { width: "20", height: "14", x: "2", y: "5", rx: "2", key: "ynyp8z" }],
  ["line", { x1: "2", x2: "22", y1: "10", y2: "10", key: "1b3vmo" }]
];
var CreditCard = createLucideIcon("CreditCard", __iconNode6);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/folder-kanban.js
var __iconNode7 = [
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
var FolderKanban = createLucideIcon("FolderKanban", __iconNode7);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/inbox.js
var __iconNode8 = [
  ["polyline", { points: "22 12 16 12 14 15 10 15 8 12 2 12", key: "o97t9d" }],
  [
    "path",
    {
      d: "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
      key: "oot6mr"
    }
  ]
];
var Inbox = createLucideIcon("Inbox", __iconNode8);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/laptop.js
var __iconNode9 = [
  [
    "path",
    {
      d: "M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16",
      key: "tarvll"
    }
  ]
];
var Laptop = createLucideIcon("Laptop", __iconNode9);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/layout-grid.js
var __iconNode10 = [
  ["rect", { width: "7", height: "7", x: "3", y: "3", rx: "1", key: "1g98yp" }],
  ["rect", { width: "7", height: "7", x: "14", y: "3", rx: "1", key: "6d4xhi" }],
  ["rect", { width: "7", height: "7", x: "14", y: "14", rx: "1", key: "nxv5o0" }],
  ["rect", { width: "7", height: "7", x: "3", y: "14", rx: "1", key: "1bb6yr" }]
];
var LayoutGrid = createLucideIcon("LayoutGrid", __iconNode10);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/list.js
var __iconNode11 = [
  ["path", { d: "M3 12h.01", key: "nlz23k" }],
  ["path", { d: "M3 18h.01", key: "1tta3j" }],
  ["path", { d: "M3 6h.01", key: "1rqtza" }],
  ["path", { d: "M8 12h13", key: "1za7za" }],
  ["path", { d: "M8 18h13", key: "1lx6n3" }],
  ["path", { d: "M8 6h13", key: "ik3vkj" }]
];
var List = createLucideIcon("List", __iconNode11);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/loader-circle.js
var __iconNode12 = [["path", { d: "M21 12a9 9 0 1 1-6.219-8.56", key: "13zald" }]];
var LoaderCircle = createLucideIcon("LoaderCircle", __iconNode12);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/lock.js
var __iconNode13 = [
  ["rect", { width: "18", height: "11", x: "3", y: "11", rx: "2", ry: "2", key: "1w4ew1" }],
  ["path", { d: "M7 11V7a5 5 0 0 1 10 0v4", key: "fwvmzm" }]
];
var Lock = createLucideIcon("Lock", __iconNode13);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/maximize-2.js
var __iconNode14 = [
  ["polyline", { points: "15 3 21 3 21 9", key: "mznyad" }],
  ["polyline", { points: "9 21 3 21 3 15", key: "1avn1i" }],
  ["line", { x1: "21", x2: "14", y1: "3", y2: "10", key: "ota7mn" }],
  ["line", { x1: "3", x2: "10", y1: "21", y2: "14", key: "1atl0r" }]
];
var Maximize2 = createLucideIcon("Maximize2", __iconNode14);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/message-square.js
var __iconNode15 = [
  ["path", { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", key: "1lielz" }]
];
var MessageSquare = createLucideIcon("MessageSquare", __iconNode15);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/panel-right.js
var __iconNode16 = [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }],
  ["path", { d: "M15 3v18", key: "14nvp0" }]
];
var PanelRight = createLucideIcon("PanelRight", __iconNode16);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/panels-top-left.js
var __iconNode17 = [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }],
  ["path", { d: "M3 9h18", key: "1pudct" }],
  ["path", { d: "M9 21V9", key: "1oto5p" }]
];
var PanelsTopLeft = createLucideIcon("PanelsTopLeft", __iconNode17);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/plug.js
var __iconNode18 = [
  ["path", { d: "M12 22v-5", key: "1ega77" }],
  ["path", { d: "M9 8V2", key: "14iosj" }],
  ["path", { d: "M15 8V2", key: "18g5xt" }],
  ["path", { d: "M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z", key: "osxo6l" }]
];
var Plug = createLucideIcon("Plug", __iconNode18);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/plus.js
var __iconNode19 = [
  ["path", { d: "M5 12h14", key: "1ays0h" }],
  ["path", { d: "M12 5v14", key: "s699le" }]
];
var Plus = createLucideIcon("Plus", __iconNode19);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/refresh-cw.js
var __iconNode20 = [
  ["path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", key: "v9h5vc" }],
  ["path", { d: "M21 3v5h-5", key: "1q7to0" }],
  ["path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", key: "3uifl3" }],
  ["path", { d: "M8 16H3v5", key: "1cv678" }]
];
var RefreshCw = createLucideIcon("RefreshCw", __iconNode20);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/search.js
var __iconNode21 = [
  ["circle", { cx: "11", cy: "11", r: "8", key: "4ej97u" }],
  ["path", { d: "m21 21-4.3-4.3", key: "1qie3q" }]
];
var Search = createLucideIcon("Search", __iconNode21);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/settings.js
var __iconNode22 = [
  [
    "path",
    {
      d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
      key: "1qme2f"
    }
  ],
  ["circle", { cx: "12", cy: "12", r: "3", key: "1v7zrd" }]
];
var Settings = createLucideIcon("Settings", __iconNode22);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/shield-check.js
var __iconNode23 = [
  [
    "path",
    {
      d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
      key: "oel41y"
    }
  ],
  ["path", { d: "m9 12 2 2 4-4", key: "dzmm74" }]
];
var ShieldCheck = createLucideIcon("ShieldCheck", __iconNode23);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/trash-2.js
var __iconNode24 = [
  ["path", { d: "M3 6h18", key: "d0wm0j" }],
  ["path", { d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", key: "4alrt4" }],
  ["path", { d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2", key: "v07s0e" }],
  ["line", { x1: "10", x2: "10", y1: "11", y2: "17", key: "1uufr5" }],
  ["line", { x1: "14", x2: "14", y1: "11", y2: "17", key: "xtxkd" }]
];
var Trash2 = createLucideIcon("Trash2", __iconNode24);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/triangle-alert.js
var __iconNode25 = [
  [
    "path",
    {
      d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
      key: "wmoenq"
    }
  ],
  ["path", { d: "M12 9v4", key: "juzpu7" }],
  ["path", { d: "M12 17h.01", key: "p32p05" }]
];
var TriangleAlert = createLucideIcon("TriangleAlert", __iconNode25);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/user.js
var __iconNode26 = [
  ["path", { d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2", key: "975kel" }],
  ["circle", { cx: "12", cy: "7", r: "4", key: "17ys0d" }]
];
var User = createLucideIcon("User", __iconNode26);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/users.js
var __iconNode27 = [
  ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", key: "1yyitq" }],
  ["circle", { cx: "9", cy: "7", r: "4", key: "nufk8" }],
  ["path", { d: "M22 21v-2a4 4 0 0 0-3-3.87", key: "kshegd" }],
  ["path", { d: "M16 3.13a4 4 0 0 1 0 7.75", key: "1da9ce" }]
];
var Users = createLucideIcon("Users", __iconNode27);

// ../../xeno-platform/.worktrees/platform-release-candidate-20260905/node_modules/lucide-react/dist/esm/icons/x.js
var __iconNode28 = [
  ["path", { d: "M18 6 6 18", key: "1bl5f8" }],
  ["path", { d: "m6 6 12 12", key: "d8bk6v" }]
];
var X = createLucideIcon("X", __iconNode28);

// src/components/account/ProjectsPage.tsx
import { useNavigate, useParams } from "react-router-dom";

// fixture:WorkspaceContext
var useWorkspace = () => globalThis.__accountFixture.workspace;

// fixture:accountService
var listProjects = (...args) => globalThis.__accountFixture.api.listProjects(...args);
var createProject = (...args) => globalThis.__accountFixture.api.createProject(...args);
var updateProject = (...args) => globalThis.__accountFixture.api.updateProject(...args);
var archiveProject = (...args) => globalThis.__accountFixture.api.archiveProject(...args);
var getAccountSessions = (...args) => globalThis.__accountFixture.api.getAccountSessions(...args);
var revokeAccountSession = (...args) => globalThis.__accountFixture.api.revokeAccountSession(...args);

// src/components/platform/ResourceState.tsx
import { jsx, jsxs } from "react/jsx-runtime";
var ResourcePreview = ({ label }) => /* @__PURE__ */ jsxs("div", { className: "xeno-resource-preview", "aria-hidden": "true", children: [
  /* @__PURE__ */ jsxs("div", { className: "xeno-resource-preview-bar", children: [
    /* @__PURE__ */ jsx("span", {}),
    /* @__PURE__ */ jsx("span", {}),
    /* @__PURE__ */ jsx("span", {}),
    /* @__PURE__ */ jsx("b", { children: label })
  ] }),
  /* @__PURE__ */ jsxs("div", { className: "xeno-resource-preview-tabs", children: [
    /* @__PURE__ */ jsx("i", {}),
    /* @__PURE__ */ jsx("i", {}),
    /* @__PURE__ */ jsx("i", {})
  ] }),
  /* @__PURE__ */ jsxs("div", { className: "xeno-resource-preview-head", children: [
    /* @__PURE__ */ jsx("span", {}),
    /* @__PURE__ */ jsx("span", {}),
    /* @__PURE__ */ jsx("span", {})
  ] }),
  [82, 66, 91, 74, 57, 86].map((width, index) => /* @__PURE__ */ jsxs("div", { className: "xeno-resource-preview-row", children: [
    /* @__PURE__ */ jsx("i", { style: { width: `${width}%` } }),
    /* @__PURE__ */ jsx("span", {}),
    /* @__PURE__ */ jsx("span", { className: index % 3 === 0 ? "is-accent" : "" })
  ] }, width))
] });
var ResourceState = ({ kind, title, detail, actionLabel, onRetry, secondaryActionLabel, onSecondaryAction, layout = "inline", previewLabel = "XENO / Platform" }) => {
  const Icon2 = kind === "loading" ? LoaderCircle : kind === "empty" ? Inbox : CircleAlert;
  const fallback = kind === "loading" ? "Loading confirmed data" : kind === "empty" ? "Nothing here yet" : kind === "unavailable" ? "Capability unavailable" : "Could not load this resource";
  return /* @__PURE__ */ jsxs("div", { className: `xeno-resource-state is-${kind} is-${layout}`, role: kind === "error" ? "alert" : "status", children: [
    /* @__PURE__ */ jsxs("div", { className: "xeno-resource-copy", children: [
      /* @__PURE__ */ jsx("span", { className: "xeno-resource-icon", children: /* @__PURE__ */ jsx(Icon2, { size: 20, className: kind === "loading" ? "xeno-spin" : "" }) }),
      /* @__PURE__ */ jsx("strong", { children: title || fallback }),
      detail ? /* @__PURE__ */ jsx("span", { children: detail }) : null,
      onRetry || onSecondaryAction ? /* @__PURE__ */ jsxs("div", { className: "xeno-resource-actions", children: [
        onRetry ? /* @__PURE__ */ jsx("button", { type: "button", className: "is-primary", onClick: onRetry, children: actionLabel || "Retry" }) : null,
        onSecondaryAction ? /* @__PURE__ */ jsx("button", { type: "button", onClick: onSecondaryAction, children: secondaryActionLabel || "Go back" }) : null
      ] }) : null
    ] }),
    layout === "page" && kind !== "loading" ? /* @__PURE__ */ jsx(ResourcePreview, { label: previewLabel }) : null
  ] });
};
var ResourceState_default = ResourceState;

// fixture:ProjectTeamAssignments
function Assignments() {
  return null;
}

// src/components/platform/DrawerLayoutControl.tsx
import { useEffect, useRef, useState } from "react";
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var DrawerLayoutControl = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return /* @__PURE__ */ jsxs2("div", { className: "xeno-drawer-layout-control", ref: rootRef, children: [
    /* @__PURE__ */ jsx2("button", { type: "button", "aria-label": "Change detail layout", "aria-expanded": open, onClick: () => setOpen((current) => !current), children: /* @__PURE__ */ jsx2(PanelsTopLeft, { size: 17 }) }),
    open ? /* @__PURE__ */ jsxs2("div", { className: "xeno-drawer-layout-menu", role: "menu", "aria-label": "Detail layout", children: [
      /* @__PURE__ */ jsx2("span", { children: "Switch layout" }),
      /* @__PURE__ */ jsxs2("button", { type: "button", role: "menuitemradio", "aria-checked": value === "side", onClick: () => {
        onChange("side");
        setOpen(false);
      }, children: [
        /* @__PURE__ */ jsx2(PanelRight, { size: 16 }),
        /* @__PURE__ */ jsx2("span", { children: "Side drawer" }),
        value === "side" ? /* @__PURE__ */ jsx2(Check, { size: 15 }) : null
      ] }),
      /* @__PURE__ */ jsxs2("button", { type: "button", role: "menuitemradio", "aria-checked": value === "full", onClick: () => {
        onChange("full");
        setOpen(false);
      }, children: [
        /* @__PURE__ */ jsx2(Maximize2, { size: 16 }),
        /* @__PURE__ */ jsx2("span", { children: "Full page" }),
        value === "full" ? /* @__PURE__ */ jsx2(Check, { size: 15 }) : null
      ] })
    ] }) : null
  ] });
};
var DrawerLayoutControl_default = DrawerLayoutControl;

// src/components/platform/ActionDialog.tsx
import { useEffect as useEffect3, useId as useId2, useRef as useRef4, useState as useState2 } from "react";

// packages/elements/src/schema.ts
function geometryMorphable(a, b) {
  const listOf2 = (g) => typeof g === "string" ? [{ kind: "path", d: g }] : g;
  const commands = (d) => (d.match(/[MmLlHhVvCcSsQqTtAaZz]/g) ?? []).join("");
  const x = listOf2(a);
  const y = listOf2(b);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) {
    const p = x[i];
    const q = y[i];
    if (p.kind !== q.kind) return false;
    if (p.kind === "path" && q.kind === "path" && commands(p.d) !== commands(q.d)) return false;
  }
  return true;
}

// packages/generate/src/scene.ts
var DEFAULT_STATE = {
  availability: "enabled",
  selection: "off",
  interaction: "idle"
};
var WEIGHT_STROKE = { light: 1.25, regular: 1.75, bold: 2.25 };
var FILL_PAINT = { foreground: "currentColor" };
var AXIS_PRECEDENCE = ["availability", "selection", "interaction"];
var finite = (n) => {
  if (!Number.isFinite(n)) throw new Error(`interpret: non-finite coordinate ${String(n)}`);
  return n;
};
var paintFor = (token) => {
  if (token === "none") return "none";
  const paint = FILL_PAINT[token];
  if (paint === void 0) {
    throw new Error(
      `interpret: unknown fill token '${token}'. A fill must reference a design-system token, never a literal colour (SPEC \xA714.2 \u2014 the guard fails closed).`
    );
  }
  return paint;
};
var listOf = (g) => typeof g === "string" ? [{ kind: "path", d: g }] : g;
var activeGeometry = (decl, state) => {
  let geometry = decl.geometry.base;
  for (const axis of AXIS_PRECEDENCE) {
    const variant = decl.geometry[`${axis}:${state[axis]}`];
    if (variant !== void 0) geometry = variant;
  }
  return geometry;
};
var shapeOf = (p) => {
  if (p.kind === "rect") {
    const base = {
      kind: "rect",
      x: finite(p.x),
      y: finite(p.y),
      w: finite(p.w),
      h: finite(p.h)
    };
    return {
      ...base,
      ...p.rx !== void 0 ? { rx: finite(p.rx) } : {},
      ...p.fill !== void 0 ? { fill: paintFor(p.fill) } : {}
    };
  }
  return {
    kind: "path",
    d: p.d,
    ...p.fill !== void 0 ? { fill: paintFor(p.fill) } : {},
    ...p.fillRule ? { fillRule: p.fillRule } : {}
  };
};
var interpret = (decl, opts = {}) => {
  const state = { ...DEFAULT_STATE, ...opts.state };
  const data = {};
  for (const axis of decl.contract.axes) data[`data-${axis}`] = state[axis];
  const active = activeGeometry(decl, state);
  return {
    viewBox: decl.contract.viewBox,
    size: opts.size ?? 24,
    strokeWidth: opts.strokeWidth ?? WEIGHT_STROKE[decl.contract.weight],
    role: decl.a11y.role,
    label: decl.a11y.label,
    glyph: decl.id.replace(/^xeno\./, ""),
    data,
    className: opts.className,
    // A declaration with only `base` has nowhere to morph TO. It would trivially pass the check, and
    // marking it would put a `d` transition on every path of every icon in the set to animate nothing.
    morph: Object.keys(decl.geometry).length > 1 && geometryMorphable(decl.geometry.base, active),
    shapes: listOf(active).map(shapeOf)
  };
};

// packages/elements-react/src/XenoElement.tsx
import { jsx as jsx3 } from "react/jsx-runtime";
var Shape = (s, i, morph) => {
  const paint = s.fill !== void 0 ? { fill: s.fill, stroke: "none" } : {};
  if (s.kind === "rect") {
    return /* @__PURE__ */ jsx3("rect", { className: "xeno-part", "data-part": i, x: s.x, y: s.y, width: s.w, height: s.h, rx: s.rx, ...paint }, i);
  }
  const morphStyle = morph ? { "--part-d": `path('${s.d}')` } : void 0;
  return /* @__PURE__ */ jsx3("path", { className: "xeno-part", "data-part": i, d: s.d, fillRule: s.fillRule, style: morphStyle, ...paint }, i);
};
function XenoElement({
  decl,
  state,
  size,
  strokeWidth,
  className,
  ...rest
}) {
  const scene = interpret(decl, {
    ...state !== void 0 ? { state } : {},
    ...size !== void 0 ? { size } : {},
    ...strokeWidth !== void 0 ? { strokeWidth } : {},
    ...className !== void 0 ? { className } : {}
  });
  return /* @__PURE__ */ jsx3(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      width: scene.size,
      height: scene.size,
      viewBox: scene.viewBox,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: scene.strokeWidth,
      strokeLinecap: "butt",
      strokeLinejoin: "round",
      role: scene.role,
      "aria-label": scene.label,
      "data-glyph": scene.glyph,
      ...scene.morph ? { "data-morph": "on" } : {},
      "data-xeno-element": "",
      className: scene.className ? `xeno-element ${scene.className}` : "xeno-element",
      ...scene.data,
      ...rest,
      children: scene.shapes.map((s, i) => Shape(s, i, scene.morph))
    }
  );
}

// packages/elements-react/src/useDialog.ts
import { useCallback, useEffect as useEffect2, useRef as useRef2 } from "react";
var FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
var scrollLocks = 0;
var scrollPrevious = "";
var lockPageScroll = () => {
  if (scrollLocks === 0) {
    scrollPrevious = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLocks += 1;
};
var unlockPageScroll = () => {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) document.body.style.overflow = scrollPrevious;
};
function useDialog({
  open,
  onClose,
  panelRef: providedRef,
  lockScroll = true
}) {
  const ownRef = useRef2(null);
  const panelRef = providedRef ?? ownRef;
  const restoreFocus = useRef2(null);
  useEffect2(() => {
    if (!open || !onClose) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  useEffect2(() => {
    if (!open || !lockScroll) return;
    lockPageScroll();
    return unlockPageScroll;
  }, [open, lockScroll]);
  const focusedOnce = useRef2(false);
  const openRef = useRef2(open);
  openRef.current = open;
  const setPanel = useCallback(
    (node) => {
      panelRef.current = node;
      if (!node || !openRef.current || focusedOnce.current) return;
      restoreFocus.current = document.activeElement;
      focusedOnce.current = true;
      node.focus();
    },
    [panelRef]
  );
  useEffect2(() => {
    if (!open) return;
    return () => {
      focusedOnce.current = false;
      restoreFocus.current?.focus?.();
    };
  }, [open]);
  const onKeyDown = useCallback(
    (e) => {
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const list = Array.from(panel.querySelectorAll(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null
      );
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const active = document.activeElement;
      if (active === panel || !list.includes(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [panelRef]
  );
  return {
    panelRef,
    panelProps: { ref: setPanel, tabIndex: -1, onKeyDown }
  };
}

// packages/elements-react/src/controls/Button.tsx
import { forwardRef as forwardRef3 } from "react";

// packages/elements/src/tokens/size.ts
var controlSize = {
  xs: { height: 24, padX: 8, gap: 5, icon: 15, font: 12 },
  sm: { height: 28, padX: 10, gap: 6, icon: 16, font: 13 },
  md: { height: 32, padX: 12, gap: 6, icon: 16, font: 14 },
  lg: { height: 36, padX: 14, gap: 7, icon: 18, font: 14 }
};

// packages/elements-react/src/controls/util.ts
var sizeAttr = (size) => ({
  "data-xeno-size": size
});
var iconPx = (size) => controlSize[size].icon;
var cx = (...parts) => parts.filter(Boolean).join(" ");

// packages/elements-react/src/controls/Button.tsx
import { jsx as jsx4, jsxs as jsxs3 } from "react/jsx-runtime";
var Button = forwardRef3(function Button2({
  variant = "secondary",
  size = "md",
  emphasis = "quiet",
  leadingIcon,
  trailingIcon,
  iconSize,
  iconReveal = false,
  busy = false,
  enter = false,
  disabled = false,
  className,
  children,
  type = "button",
  ...rest
}, ref) {
  const availability = disabled ? "disabled" : busy ? "busy" : "enabled";
  const glyph = iconSize ?? iconPx(size);
  const revealSide = iconReveal === true ? "leading" : iconReveal || void 0;
  return /* @__PURE__ */ jsxs3(
    "button",
    {
      ref,
      type,
      className: cx("xeno-btn", className),
      "data-variant": variant,
      "data-emphasis": emphasis,
      "data-availability": availability,
      "data-enter": enter ? "" : void 0,
      "data-icon-reveal": revealSide,
      disabled,
      "aria-busy": busy || void 0,
      ...sizeAttr(size),
      ...rest,
      children: [
        leadingIcon && /* @__PURE__ */ jsx4(XenoElement, { decl: leadingIcon, size: glyph }),
        revealSide ? /* @__PURE__ */ jsx4("span", { className: "xeno-btn-label", children }) : children,
        trailingIcon && /* @__PURE__ */ jsx4(XenoElement, { decl: trailingIcon, size: glyph })
      ]
    }
  );
});

// packages/elements-react/src/controls/IconButton.tsx
import { forwardRef as forwardRef4 } from "react";
import { jsx as jsx5 } from "react/jsx-runtime";
var IconButton = forwardRef4(function IconButton2({
  icon,
  variant = "ghost",
  size = "md",
  busy = false,
  enter = false,
  iconSize,
  iconState,
  disabled = false,
  className,
  type = "button",
  ...rest
}, ref) {
  const availability = disabled ? "disabled" : busy ? "busy" : "enabled";
  return /* @__PURE__ */ jsx5(
    "button",
    {
      ref,
      type,
      className: cx("xeno-btn", "xeno-icon-btn", className),
      "data-variant": variant,
      "data-availability": availability,
      "data-enter": enter ? "" : void 0,
      disabled,
      "aria-busy": busy || void 0,
      ...sizeAttr(size),
      ...rest,
      children: /* @__PURE__ */ jsx5(XenoElement, { decl: icon, size: iconSize ?? iconPx(size), ...iconState ? { state: iconState } : {} })
    }
  );
});

// packages/elements-react/src/controls/TextInput.tsx
import { jsx as jsx6, jsxs as jsxs4 } from "react/jsx-runtime";
function TextInput({
  size = "md",
  leadingIcon,
  iconSize,
  fontSize,
  disabled = false,
  className,
  ...rest
}) {
  return /* @__PURE__ */ jsxs4(
    "div",
    {
      className: cx("xeno-input", className),
      "data-availability": disabled ? "disabled" : "enabled",
      style: fontSize === void 0 ? void 0 : { "--xeno-font": `${fontSize}px` },
      ...sizeAttr(size),
      children: [
        leadingIcon && /* @__PURE__ */ jsx6("span", { className: "xeno-input-icon", "aria-hidden": "true", children: /* @__PURE__ */ jsx6(XenoElement, { decl: leadingIcon, size: iconSize ?? iconPx(size) }) }),
        /* @__PURE__ */ jsx6("input", { className: "xeno-input-field", disabled, ...rest })
      ]
    }
  );
}

// packages/elements/src/elements/x.ts
var X2 = {
  id: "xeno.x",
  kind: "icon",
  contract: { viewBox: "0 0 24 24", weight: "regular", strokeFamily: "xeno-regular", axes: [], signals: [] },
  geometry: {
    base: [
      { kind: "path", d: "M6.5 6.5l11 11M17.5 6.5l-11 11" }
    ]
  },
  bindings: [],
  a11y: { role: "img", label: "Close" },
  meta: { tags: ["cancel", "dismiss", "cross"], since: "0.1.0" }
};
var x_default = X2;

// packages/elements-react/src/overlays/Modal.tsx
import { useCallback as useCallback2, useId, useRef as useRef3 } from "react";
import { jsx as jsx7, jsxs as jsxs5 } from "react/jsx-runtime";
function Modal({
  open,
  onClose,
  dismissDisabled = false,
  title,
  children,
  footer,
  variant = "center",
  closeLabel = "Close",
  className,
  ...rest
}) {
  const titleId = useId();
  const scrimArmed = useRef3(false);
  const requestClose = useCallback2(() => {
    if (!dismissDisabled) onClose();
  }, [dismissDisabled, onClose]);
  const { panelProps } = useDialog({ open, onClose: requestClose });
  if (!open) return null;
  const onScrimMouseDown = (e) => {
    scrimArmed.current = e.target === e.currentTarget;
  };
  const onScrimClick = (e) => {
    if (e.target === e.currentTarget && scrimArmed.current) requestClose();
    scrimArmed.current = false;
  };
  return /* @__PURE__ */ jsx7(
    "div",
    {
      className: "xeno-modal-overlay",
      "data-variant": variant,
      onMouseDown: onScrimMouseDown,
      onClick: onScrimClick,
      children: /* @__PURE__ */ jsxs5(
        "div",
        {
          ...rest,
          ...panelProps,
          role: "dialog",
          "aria-modal": "true",
          ...title !== void 0 ? { "aria-labelledby": titleId } : {},
          className: cx("xeno-modal", className),
          "data-variant": variant,
          children: [
            /* @__PURE__ */ jsxs5("div", { className: "xeno-modal-header", children: [
              title !== void 0 ? /* @__PURE__ */ jsx7("h2", { id: titleId, className: "xeno-modal-title", children: title }) : null,
              /* @__PURE__ */ jsx7(
                IconButton,
                {
                  icon: x_default,
                  "aria-label": closeLabel,
                  className: "xeno-modal-close",
                  disabled: dismissDisabled,
                  onClick: requestClose
                }
              )
            ] }),
            /* @__PURE__ */ jsx7("div", { className: "xeno-modal-body", children }),
            footer !== void 0 ? /* @__PURE__ */ jsx7("div", { className: "xeno-modal-footer", children: footer }) : null
          ]
        }
      )
    }
  );
}

// fixture:platformTheme
var usePlatformTheme = () => ({ resolvedTheme: "dark", themeStyle: {} });
var normalizePlatformTheme = () => "dark";
var normalizePlatformThemeBrightness = () => 0;
var getPlatformThemePosition = () => 0;
var savePlatformTheme = async () => ({});

// src/components/platform/ActionDialog.tsx
import { Fragment, jsx as jsx8, jsxs as jsxs6 } from "react/jsx-runtime";
function ActionDialog({
  title,
  detail,
  confirmLabel,
  destructive = false,
  fieldLabel,
  initialValue = "",
  choices,
  onConfirm,
  onClose,
  recovery
}) {
  const formId = useId2();
  const fieldId = useId2();
  const detailId = useId2();
  const [value, setValue] = useState2(initialValue);
  const [pending, setPending] = useState2(false);
  const [error, setError] = useState2("");
  const inFlight = useRef4(false);
  const mounted = useRef4(true);
  const { resolvedTheme, themeStyle } = usePlatformTheme();
  useEffect3(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const invalid = choices ? !choices.some((choice) => choice.value === value) : Boolean(fieldLabel && (!value.trim() || value.trim().length > 255));
  const close = () => {
    if (!inFlight.current) onClose();
  };
  const submit = async (event) => {
    event.preventDefault();
    if (inFlight.current || invalid || error && recovery) return;
    inFlight.current = true;
    event.currentTarget.closest('[role="dialog"]')?.focus();
    setPending(true);
    setError("");
    try {
      await onConfirm(value.trim());
      if (mounted.current) onClose();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "The operation could not be confirmed.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  };
  return /* @__PURE__ */ jsx8("div", { className: "xeno chat-themed", "data-theme": resolvedTheme, "data-style": "industrial", style: themeStyle, children: /* @__PURE__ */ jsx8(
    Modal,
    {
      open: true,
      title,
      onClose: close,
      dismissDisabled: pending,
      "aria-busy": pending,
      "aria-describedby": detailId,
      footer: /* @__PURE__ */ jsxs6(Fragment, { children: [
        /* @__PURE__ */ jsx8(Button, { onClick: close, disabled: pending, children: "Cancel" }),
        error && recovery ? /* @__PURE__ */ jsx8(Button, { variant: "primary", onClick: recovery.onRecover, children: recovery.label }) : /* @__PURE__ */ jsx8(
          Button,
          {
            variant: destructive ? "danger" : "primary",
            type: "submit",
            form: formId,
            disabled: pending || invalid,
            busy: pending,
            children: pending ? "Working\u2026" : confirmLabel
          }
        )
      ] }),
      children: /* @__PURE__ */ jsxs6("form", { id: formId, onSubmit: submit, children: [
        /* @__PURE__ */ jsx8("p", { id: detailId, children: detail }),
        choices ? /* @__PURE__ */ jsxs6("fieldset", { disabled: pending, style: { border: 0, margin: 0, padding: 0 }, children: [
          fieldLabel ? /* @__PURE__ */ jsx8("legend", { children: fieldLabel }) : null,
          choices.map((choice) => /* @__PURE__ */ jsxs6(
            "label",
            {
              htmlFor: `${fieldId}-${choice.value}`,
              style: { display: "flex", alignItems: "center", gap: "8px", padding: "4px 0" },
              children: [
                /* @__PURE__ */ jsx8(
                  "input",
                  {
                    type: "radio",
                    id: `${fieldId}-${choice.value}`,
                    name: fieldId,
                    value: choice.value,
                    checked: value === choice.value,
                    disabled: pending,
                    onChange: () => setValue(choice.value)
                  }
                ),
                /* @__PURE__ */ jsx8("span", { children: choice.label })
              ]
            },
            choice.value
          ))
        ] }) : null,
        !choices && fieldLabel ? /* @__PURE__ */ jsxs6("label", { htmlFor: fieldId, children: [
          fieldLabel,
          /* @__PURE__ */ jsx8(
            TextInput,
            {
              id: fieldId,
              value,
              onChange: (event) => setValue(event.target.value),
              maxLength: 255,
              required: true,
              disabled: pending
            }
          )
        ] }) : null,
        pending ? /* @__PURE__ */ jsx8("p", { role: "status", children: "Waiting for the server to confirm this operation." }) : null,
        error ? /* @__PURE__ */ jsxs6("p", { role: "alert", children: [
          error,
          recovery ? " Sign in again to check the outcome; revocation was not confirmed." : ""
        ] }) : null
      ] })
    }
  ) });
}

// src/components/account/ProjectsPage.tsx
import { jsx as jsx9, jsxs as jsxs7 } from "react/jsx-runtime";
var projectState = (project) => project.is_archived ? "Archived" : String(project.settings?.status || "Active");
var dateLabel = (value) => new Date(value).toLocaleDateString(void 0, { month: "short", day: "numeric", year: "numeric" });
var ProjectsPage = () => {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const { activeWorkspace, isLoading: workspaceLoading } = useWorkspace();
  const activeWorkspaceId = useRef5(activeWorkspace?.id);
  activeWorkspaceId.current = activeWorkspace?.id;
  const actionContext = useRef5({ workspaceId: activeWorkspace?.id, projectId, generation: 0 });
  if (actionContext.current.workspaceId !== activeWorkspace?.id || actionContext.current.projectId !== projectId) {
    actionContext.current = { workspaceId: activeWorkspace?.id, projectId, generation: actionContext.current.generation + 1 };
  }
  const loadGeneration = useRef5(0);
  const [loadedWorkspaceId, setLoadedWorkspaceId] = useState3();
  const [projects, setProjects] = useState3([]);
  const [state, setState] = useState3("loading");
  const [error, setError] = useState3("");
  const [query, setQuery] = useState3("");
  const [view, setView] = useState3(() => localStorage.getItem("xeno_projects_view") || "list");
  const [creating, setCreating] = useState3(false);
  const [name, setName] = useState3("");
  const [description, setDescription] = useState3("");
  const [busy, setBusy] = useState3("");
  const [projectAction, setProjectAction] = useState3(null);
  const confirmedArchive = useRef5();
  const [drawerLayout, setDrawerLayout] = useState3(() => localStorage.getItem("xeno_detail_layout") === "full" ? "full" : "side");
  const changeDrawerLayout = (layout) => {
    setDrawerLayout(layout);
    localStorage.setItem("xeno_detail_layout", layout);
  };
  const load = useCallback3(async () => {
    if (!activeWorkspace?.id) return;
    const workspaceId = activeWorkspace.id;
    const generation = ++loadGeneration.current;
    setState("loading");
    setError("");
    setProjectAction(null);
    setProjects([]);
    try {
      const result = await listProjects(workspaceId);
      if (activeWorkspaceId.current !== workspaceId || generation !== loadGeneration.current) return;
      setProjects(result.projects || []);
      setLoadedWorkspaceId(workspaceId);
      setState("ready");
    } catch (cause) {
      if (activeWorkspaceId.current !== workspaceId || generation !== loadGeneration.current) return;
      setProjects([]);
      setError(cause instanceof Error ? cause.message : "Projects are unavailable.");
      setState("error");
    }
  }, [activeWorkspace?.id]);
  useEffect4(() => {
    setProjectAction(null);
  }, [activeWorkspace?.id, projectId]);
  useEffect4(() => {
    if (activeWorkspace?.id) void load();
  }, [load, activeWorkspace?.id]);
  useEffect4(() => {
    setCreating(false);
    setName("");
    setDescription("");
    setBusy("");
    setQuery("");
    return () => {
      ++loadGeneration.current;
    };
  }, [activeWorkspace?.id]);
  const selectView = (next) => {
    setView(next);
    localStorage.setItem("xeno_projects_view", next);
  };
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return loadedWorkspaceId === activeWorkspace?.id ? projects.filter((project) => !needle || `${project.name} ${project.description || ""}`.toLowerCase().includes(needle)) : [];
  }, [projects, query, loadedWorkspaceId, activeWorkspace?.id]);
  const selected = loadedWorkspaceId === activeWorkspace?.id ? projects.find((project) => project.id === projectId) || null : null;
  const submitCreate = async (event) => {
    event.preventDefault();
    if (!activeWorkspace?.id || !name.trim()) return;
    const workspaceId = activeWorkspace.id;
    setBusy("create");
    setError("");
    try {
      const result = await createProject(name.trim(), workspaceId, description.trim() || void 0);
      if (activeWorkspaceId.current !== workspaceId) return;
      setProjects((current) => [result.project, ...current]);
      setName("");
      setDescription("");
      setCreating(false);
      navigate(`/overview/projects/${result.project.id}`);
    } catch (cause) {
      if (activeWorkspaceId.current === workspaceId) setError(cause instanceof Error ? cause.message : "Project creation failed.");
    } finally {
      if (activeWorkspaceId.current === workspaceId) setBusy("");
    }
  };
  const renameSelected = () => {
    if (selected && activeWorkspace?.id) setProjectAction({ kind: "rename", project: selected, workspaceId: activeWorkspace.id });
  };
  const archiveSelected = () => {
    confirmedArchive.current = void 0;
    if (selected && activeWorkspace?.id) setProjectAction({ kind: "archive", project: selected, workspaceId: activeWorkspace.id });
  };
  const confirmProjectAction = async (action, next) => {
    if (activeWorkspaceId.current !== action.workspaceId || projectId !== action.project.id) throw new Error("The active project changed. Reopen the action in its workspace.");
    const generation = loadGeneration.current;
    const contextGeneration = actionContext.current.generation;
    const stillCurrent = () => activeWorkspaceId.current === action.workspaceId && loadGeneration.current === generation && actionContext.current.generation === contextGeneration;
    if (action.kind === "rename" && next === action.project.name) return;
    setBusy(action.project.id);
    setError("");
    try {
      if (action.kind === "rename") {
        if (!next || next.length > 255) throw new Error("Enter a project name of 1\u2013255 characters.");
        const result = await updateProject(action.project.id, { name: next });
        if (!stillCurrent()) return;
        if (result.project.id !== action.project.id || result.project.name !== next) throw new Error("The server did not confirm the requested project name.");
        setProjects((current) => current.map((item) => item.id === action.project.id ? result.project : item));
      } else {
        if (confirmedArchive.current !== action.project.id) {
          await archiveProject(action.project.id);
          if (!stillCurrent()) return;
          confirmedArchive.current = action.project.id;
        }
        if (!stillCurrent()) return;
        const result = await listProjects(action.workspaceId);
        if (!stillCurrent()) return;
        if (result.projects.some((item) => item.id === action.project.id && !item.is_archived)) throw new Error("The project is still active after the archive request.");
        setProjects(result.projects.filter((item) => !item.is_archived));
        navigate("/overview/projects");
      }
    } finally {
      if (stillCurrent()) setBusy("");
    }
  };
  if (workspaceLoading && !activeWorkspace) return /* @__PURE__ */ jsx9("main", { className: "xeno-platform-page", children: /* @__PURE__ */ jsx9(ResourceState_default, { kind: "loading", title: "Loading workspace projects" }) });
  if (!activeWorkspace) return /* @__PURE__ */ jsx9("main", { className: "xeno-platform-page", children: /* @__PURE__ */ jsx9(ResourceState_default, { kind: "unavailable", layout: "page", title: "Choose a workspace first", detail: "Projects are durable workspace resources. Select or create a workspace to manage them." }) });
  return /* @__PURE__ */ jsxs7("main", { className: "xeno-platform-page xeno-projects-page", children: [
    /* @__PURE__ */ jsxs7("header", { className: "xeno-platform-page-header", children: [
      /* @__PURE__ */ jsxs7("div", { children: [
        /* @__PURE__ */ jsx9("span", { className: "xeno-page-eyebrow", children: activeWorkspace.name }),
        /* @__PURE__ */ jsx9("h1", { children: "Projects" }),
        /* @__PURE__ */ jsx9("p", { children: "Workspace projects for conversations, files, instructions, schedules, and agent work." })
      ] }),
      /* @__PURE__ */ jsxs7("div", { className: "xeno-header-actions", children: [
        /* @__PURE__ */ jsxs7("button", { type: "button", className: "xeno-page-button", onClick: () => void load(), children: [
          /* @__PURE__ */ jsx9(RefreshCw, { size: 15 }),
          "Refresh"
        ] }),
        /* @__PURE__ */ jsxs7("button", { type: "button", className: "xeno-page-button is-primary", onClick: () => setCreating(true), children: [
          /* @__PURE__ */ jsx9(Plus, { size: 15 }),
          "New project"
        ] })
      ] })
    ] }),
    error ? /* @__PURE__ */ jsx9("div", { className: "xeno-inline-error", role: "alert", children: error }) : null,
    /* @__PURE__ */ jsxs7("div", { className: "xeno-project-toolbar", children: [
      /* @__PURE__ */ jsxs7("label", { children: [
        /* @__PURE__ */ jsx9(Search, { size: 15 }),
        /* @__PURE__ */ jsx9("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Search projects" })
      ] }),
      /* @__PURE__ */ jsxs7("div", { role: "group", "aria-label": "Project view", children: [
        /* @__PURE__ */ jsxs7("button", { type: "button", className: view === "list" ? "is-active" : "", onClick: () => selectView("list"), children: [
          /* @__PURE__ */ jsx9(List, { size: 15 }),
          "List"
        ] }),
        /* @__PURE__ */ jsxs7("button", { type: "button", className: view === "board" ? "is-active" : "", onClick: () => selectView("board"), children: [
          /* @__PURE__ */ jsx9(LayoutGrid, { size: 15 }),
          "Board"
        ] }),
        /* @__PURE__ */ jsxs7("button", { type: "button", className: view === "calendar" ? "is-active" : "", onClick: () => selectView("calendar"), children: [
          /* @__PURE__ */ jsx9(CalendarDays, { size: 15 }),
          "Calendar"
        ] })
      ] })
    ] }),
    state === "loading" ? /* @__PURE__ */ jsx9(ResourceState_default, { kind: "loading", title: "Loading persisted projects" }) : state === "error" ? /* @__PURE__ */ jsx9(ResourceState_default, { kind: "error", title: "We couldn't load projects", detail: error, actionLabel: "Try again", onRetry: () => void load() }) : filtered.length === 0 ? /* @__PURE__ */ jsx9(ResourceState_default, { kind: "empty", layout: "page", previewLabel: "Workspace / Projects", title: query ? "No matching projects" : "No projects yet", detail: query ? "Change the search or clear it to see all projects." : "Create a persisted project to keep conversations, files, instructions, schedules, and agent work together.", actionLabel: query ? "Clear search" : "Create project", onRetry: () => query ? setQuery("") : setCreating(true) }) : view === "list" ? /* @__PURE__ */ jsxs7("section", { className: "xeno-data-card xeno-project-list", children: [
      /* @__PURE__ */ jsxs7("header", { children: [
        /* @__PURE__ */ jsx9("span", { children: "Name" }),
        /* @__PURE__ */ jsx9("span", { children: "Contents" }),
        /* @__PURE__ */ jsx9("span", { children: "Status" }),
        /* @__PURE__ */ jsx9("span", { children: "Updated" })
      ] }),
      filtered.map((project) => /* @__PURE__ */ jsxs7("button", { type: "button", onClick: () => navigate(`/overview/projects/${project.id}`), children: [
        /* @__PURE__ */ jsxs7("span", { children: [
          /* @__PURE__ */ jsx9("i", { children: /* @__PURE__ */ jsx9(FolderKanban, { size: 16 }) }),
          /* @__PURE__ */ jsx9("b", { children: project.name }),
          /* @__PURE__ */ jsx9("small", { children: project.description || "No description" })
        ] }),
        /* @__PURE__ */ jsxs7("span", { children: [
          Number(project.chat_count || 0),
          " chats \xB7 ",
          Number(project.file_count || 0),
          " files"
        ] }),
        /* @__PURE__ */ jsx9("span", { children: projectState(project) }),
        /* @__PURE__ */ jsx9("time", { children: dateLabel(project.updated_at) })
      ] }, project.id))
    ] }) : view === "board" ? /* @__PURE__ */ jsx9("section", { className: "xeno-project-board", children: /* @__PURE__ */ jsxs7("div", { children: [
      /* @__PURE__ */ jsxs7("header", { children: [
        /* @__PURE__ */ jsx9("span", { children: "Active" }),
        /* @__PURE__ */ jsx9("b", { children: filtered.filter((item) => !item.is_archived).length })
      ] }),
      filtered.filter((item) => !item.is_archived).map((project) => /* @__PURE__ */ jsxs7("button", { type: "button", onClick: () => navigate(`/overview/projects/${project.id}`), children: [
        /* @__PURE__ */ jsx9(FolderKanban, { size: 16 }),
        /* @__PURE__ */ jsx9("strong", { children: project.name }),
        /* @__PURE__ */ jsx9("p", { children: project.description || "No description" }),
        /* @__PURE__ */ jsxs7("small", { children: [
          Number(project.chat_count || 0),
          " chats \xB7 updated ",
          dateLabel(project.updated_at)
        ] })
      ] }, project.id))
    ] }) }) : /* @__PURE__ */ jsx9("section", { className: "xeno-data-card xeno-project-calendar", children: filtered.map((project) => /* @__PURE__ */ jsxs7("button", { type: "button", onClick: () => navigate(`/overview/projects/${project.id}`), children: [
      /* @__PURE__ */ jsx9("time", { children: new Date(project.updated_at).toLocaleDateString(void 0, { month: "short", day: "2-digit" }) }),
      /* @__PURE__ */ jsxs7("span", { children: [
        /* @__PURE__ */ jsx9("strong", { children: project.name }),
        /* @__PURE__ */ jsxs7("small", { children: [
          "Last persisted update \xB7 ",
          Number(project.chat_count || 0),
          " chats"
        ] })
      ] })
    ] }, project.id)) }),
    creating ? /* @__PURE__ */ jsx9("div", { className: "xeno-drawer-backdrop", onMouseDown: (event) => {
      if (event.target === event.currentTarget) setCreating(false);
    }, children: /* @__PURE__ */ jsxs7("aside", { className: "xeno-detail-drawer", role: "dialog", "aria-modal": "true", "aria-label": "Create project", children: [
      /* @__PURE__ */ jsxs7("header", { children: [
        /* @__PURE__ */ jsx9("span", { className: "xeno-integration-logo", children: /* @__PURE__ */ jsx9(FolderKanban, { size: 20 }) }),
        /* @__PURE__ */ jsxs7("span", { children: [
          /* @__PURE__ */ jsx9("small", { children: activeWorkspace.name }),
          /* @__PURE__ */ jsx9("h2", { children: "New project" })
        ] }),
        /* @__PURE__ */ jsx9("button", { type: "button", onClick: () => setCreating(false), "aria-label": "Close", children: /* @__PURE__ */ jsx9(X, { size: 18 }) })
      ] }),
      /* @__PURE__ */ jsxs7("form", { className: "xeno-project-form", onSubmit: submitCreate, children: [
        /* @__PURE__ */ jsxs7("label", { children: [
          "Project name",
          /* @__PURE__ */ jsx9("input", { autoFocus: true, required: true, maxLength: 255, value: name, onChange: (event) => setName(event.target.value) })
        ] }),
        /* @__PURE__ */ jsxs7("label", { children: [
          "Description",
          /* @__PURE__ */ jsx9("textarea", { rows: 5, value: description, onChange: (event) => setDescription(event.target.value) })
        ] }),
        /* @__PURE__ */ jsx9("p", { children: "This creates a server-backed project in the active workspace. It is immediately available to people and agents with access." }),
        /* @__PURE__ */ jsx9("button", { type: "submit", className: "xeno-page-button is-primary", disabled: busy === "create", children: busy === "create" ? "Creating\u2026" : "Create project" })
      ] })
    ] }) }) : null,
    selected ? /* @__PURE__ */ jsx9("div", { className: "xeno-drawer-backdrop", onMouseDown: (event) => {
      if (event.target === event.currentTarget) navigate("/overview/projects");
    }, children: /* @__PURE__ */ jsxs7("aside", { className: `xeno-detail-drawer${drawerLayout === "full" ? " is-fullpage" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": `${selected.name} details`, children: [
      /* @__PURE__ */ jsxs7("header", { children: [
        /* @__PURE__ */ jsx9("span", { className: "xeno-integration-logo", children: /* @__PURE__ */ jsx9(FolderKanban, { size: 20 }) }),
        /* @__PURE__ */ jsxs7("span", { children: [
          /* @__PURE__ */ jsx9("small", { children: projectState(selected) }),
          /* @__PURE__ */ jsx9("h2", { children: selected.name })
        ] }),
        /* @__PURE__ */ jsx9(DrawerLayoutControl_default, { value: drawerLayout, onChange: changeDrawerLayout }),
        /* @__PURE__ */ jsx9("button", { type: "button", onClick: () => navigate("/overview/projects"), "aria-label": "Close", children: /* @__PURE__ */ jsx9(X, { size: 18 }) })
      ] }),
      /* @__PURE__ */ jsxs7("nav", { className: "xeno-drawer-tabs", "aria-label": "Project detail sections", children: [
        /* @__PURE__ */ jsx9("button", { type: "button", className: "is-active", children: "Overview" }),
        /* @__PURE__ */ jsx9("button", { type: "button", disabled: true, children: "Activity" }),
        /* @__PURE__ */ jsx9("span", { children: "Persisted project" })
      ] }),
      /* @__PURE__ */ jsxs7("section", { children: [
        /* @__PURE__ */ jsx9("p", { children: selected.description || "No description has been added." }),
        /* @__PURE__ */ jsxs7("dl", { className: "xeno-project-facts", children: [
          /* @__PURE__ */ jsxs7("div", { children: [
            /* @__PURE__ */ jsx9("dt", { children: "Conversations" }),
            /* @__PURE__ */ jsx9("dd", { children: Number(selected.chat_count || 0) })
          ] }),
          /* @__PURE__ */ jsxs7("div", { children: [
            /* @__PURE__ */ jsx9("dt", { children: "Files" }),
            /* @__PURE__ */ jsx9("dd", { children: Number(selected.file_count || 0) })
          ] }),
          /* @__PURE__ */ jsxs7("div", { children: [
            /* @__PURE__ */ jsx9("dt", { children: "Updated" }),
            /* @__PURE__ */ jsx9("dd", { children: dateLabel(selected.updated_at) })
          ] })
        ] }),
        /* @__PURE__ */ jsx9(Assignments, { workspaceId: activeWorkspace.id, projectId: selected.id }, `${activeWorkspace.id}:${selected.id}`),
        /* @__PURE__ */ jsxs7("div", { className: "xeno-project-actions", children: [
          /* @__PURE__ */ jsxs7("button", { type: "button", className: "xeno-page-button is-primary", onClick: () => navigate(`/overview/chat/projects/${selected.id}`), children: [
            /* @__PURE__ */ jsx9(MessageSquare, { size: 15 }),
            "Open project chat"
          ] }),
          /* @__PURE__ */ jsx9("button", { type: "button", className: "xeno-page-button", disabled: busy === selected.id, onClick: () => void renameSelected(), children: "Rename" }),
          /* @__PURE__ */ jsxs7("button", { type: "button", className: "xeno-page-button", disabled: busy === selected.id, onClick: () => void archiveSelected(), children: [
            /* @__PURE__ */ jsx9(Archive, { size: 15 }),
            "Archive"
          ] })
        ] })
      ] })
    ] }) }) : null,
    projectAction && projectAction.workspaceId === activeWorkspace.id && projectAction.project.id === selected?.id ? /* @__PURE__ */ jsx9(
      ActionDialog,
      {
        title: projectAction.kind === "rename" ? "Rename project" : "Archive project",
        detail: projectAction.kind === "rename" ? `Rename \u201C${projectAction.project.name}\u201D.` : `Archive \u201C${projectAction.project.name}\u201D? Its active schedules will be paused.`,
        confirmLabel: projectAction.kind === "rename" ? "Save name" : "Archive project",
        destructive: projectAction.kind === "archive",
        fieldLabel: projectAction.kind === "rename" ? "Project name" : void 0,
        initialValue: projectAction.project.name,
        onConfirm: (next) => confirmProjectAction(projectAction, next),
        onClose: () => setProjectAction(null)
      },
      `${projectAction.workspaceId}:${projectAction.project.id}:${projectAction.kind}`
    ) : null
  ] });
};
var ProjectsPage_default = ProjectsPage;

// src/components/account/SettingsPage.tsx
import { useEffect as useEffect5, useRef as useRef6, useState as useState4 } from "react";
import { useNavigate as useNavigate3 } from "react-router-dom";

// fixture:AuthContext
var useAuth = () => ({ logout: globalThis.__accountFixture.logout });

// fixture:authService
var authService = {};

// fixture:userDataService
var userDataService = { getSettings: async () => ({}), updateSetting: async () => ({}) };

// src/components/account/AccountSettingsNav.tsx
import { useLocation, useNavigate as useNavigate2 } from "react-router-dom";
import { jsx as jsx10, jsxs as jsxs8 } from "react/jsx-runtime";
var sections = [
  { label: "Profile", path: "/overview/profile", icon: User },
  { label: "Preferences", path: "/overview/settings", icon: Settings },
  { label: "Members", path: "/overview/team", icon: Users },
  { label: "Teams", path: "/overview/teams", icon: Users },
  { label: "Security", path: "/overview/settings", icon: ShieldCheck, hash: "#security" },
  { label: "Integrations", path: "/overview/integrations", icon: Plug },
  { label: "Billing", path: "/overview/billing", icon: CreditCard },
  { label: "Notifications", path: "/overview/notifications", icon: Bell }
];
var AccountSettingsNav = () => {
  const navigate = useNavigate2();
  const location = useLocation();
  return /* @__PURE__ */ jsx10("nav", { className: "xeno-account-tabs", "aria-label": "Account settings sections", children: sections.map(({ label, path, icon: Icon2, hash }) => {
    const target = `${path}${hash || ""}`;
    const active = hash ? location.pathname === path && location.hash === hash : location.pathname === path && !location.hash;
    return /* @__PURE__ */ jsxs8(
      "button",
      {
        type: "button",
        className: active ? "is-active" : "",
        "aria-label": label,
        title: label,
        "aria-current": active ? "page" : void 0,
        onClick: () => navigate(target),
        children: [
          /* @__PURE__ */ jsx10(Icon2, { size: 15, strokeWidth: 1.7, "aria-hidden": "true" }),
          /* @__PURE__ */ jsx10("span", { children: label })
        ]
      },
      label
    );
  }) });
};
var AccountSettingsNav_default = AccountSettingsNav;

// src/components/account/SettingsPage.tsx
import { jsx as jsx11, jsxs as jsxs9 } from "react/jsx-runtime";
var SettingsPage = () => {
  const navigate = useNavigate3();
  const { logout } = useAuth();
  const [settings, setSettings] = useState4({});
  const [loading, setLoading] = useState4(true);
  const [saving, setSaving] = useState4(false);
  const [notice, setNotice] = useState4("");
  const [error, setError] = useState4("");
  const [passwordOpen, setPasswordOpen] = useState4(false);
  const [currentPassword, setCurrentPassword] = useState4("");
  const [newPassword, setNewPassword] = useState4("");
  const [confirmPassword, setConfirmPassword] = useState4("");
  const [deleteOpen, setDeleteOpen] = useState4(false);
  const [deletePassword, setDeletePassword] = useState4("");
  const [sessions, setSessions] = useState4([]);
  const [sessionsLoading, setSessionsLoading] = useState4(true);
  const [sessionBusy, setSessionBusy] = useState4("");
  const [sessionsError, setSessionsError] = useState4("");
  const [sessionAction, setSessionAction] = useState4(null);
  const confirmedRevocation = useRef6();
  useEffect5(() => {
    userDataService.getSettings().then(setSettings).catch((err) => setError(err instanceof Error ? err.message : "Settings unavailable")).finally(() => setLoading(false));
  }, []);
  const loadSessions = async () => {
    setSessionsLoading(true);
    setSessionsError("");
    try {
      const result = await getAccountSessions();
      setSessions(result.sessions);
    } catch (err) {
      setSessions([]);
      setSessionsError(err instanceof Error ? err.message : "Sessions unavailable");
    } finally {
      setSessionsLoading(false);
    }
  };
  useEffect5(() => {
    void loadSessions();
  }, []);
  const revokeSession = (session) => {
    confirmedRevocation.current = void 0;
    setSessionAction(session);
  };
  const confirmSessionRevocation = async (session) => {
    setSessionBusy(session.id);
    setError("");
    try {
      if (confirmedRevocation.current !== session.id) {
        const receipt = await revokeAccountSession(session.id);
        if (receipt.revoked_session_id !== session.id) throw new Error("The server did not confirm the requested session revocation.");
        confirmedRevocation.current = session.id;
      }
      if (session.current) {
        logout?.();
        navigate("/login");
        return;
      }
      const readBack = await getAccountSessions();
      setSessions(readBack.sessions);
      if (readBack.sessions.some((item) => item.id === session.id)) throw new Error("The session is still active after revocation.");
      setNotice("Session revoked and confirmed absent from the active session list.");
    } finally {
      setSessionBusy("");
    }
  };
  const update = async (path, value) => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const next = await userDataService.updateSetting(path, value);
      setSettings(next);
      setNotice("Settings saved and confirmed by the server.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The server did not confirm this setting.");
    } finally {
      setSaving(false);
    }
  };
  const updateTheme = async (nextTheme, nextBrightness) => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const confirmed = await savePlatformTheme(nextTheme, nextBrightness);
      setSettings((current) => ({ ...current, appearance: { ...current.appearance, theme: confirmed.preference, themeBrightness: confirmed.brightness } }));
      setNotice("Platform theme saved and applied everywhere.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The server did not confirm this theme.");
    } finally {
      setSaving(false);
    }
  };
  const changePassword = async () => {
    setError("");
    if (!currentPassword || newPassword.length < 6 || newPassword !== confirmPassword) {
      setError("Enter the current password and matching new passwords of at least 6 characters.");
      return;
    }
    setSaving(true);
    try {
      const result = await authService.changePassword(currentPassword, newPassword);
      if (!result.success) throw new Error(result.error || "Password update failed");
      setPasswordOpen(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice("Password changed successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password update failed");
    } finally {
      setSaving(false);
    }
  };
  const deleteAccount = async () => {
    if (!deletePassword) {
      setError("Password is required to delete the account.");
      return;
    }
    setSaving(true);
    try {
      const result = await authService.deleteAccount(deletePassword);
      if (!result.success) throw new Error(result.error || "Account deletion failed");
      logout?.();
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Account deletion failed");
      setSaving(false);
    }
  };
  if (loading) return /* @__PURE__ */ jsx11("main", { className: "xeno-platform-page", children: /* @__PURE__ */ jsx11(ResourceState_default, { kind: "loading", title: "Loading account settings" }) });
  const theme = normalizePlatformTheme(settings.appearance?.theme) || "system";
  const themeBrightness = normalizePlatformThemeBrightness(settings.appearance?.themeBrightness);
  const fontSize = settings.appearance?.fontSize || "medium";
  return /* @__PURE__ */ jsxs9("main", { className: "xeno-platform-page xeno-account-page", children: [
    /* @__PURE__ */ jsxs9("header", { className: "xeno-platform-page-header", children: [
      /* @__PURE__ */ jsxs9("div", { children: [
        /* @__PURE__ */ jsx11("span", { className: "xeno-page-eyebrow", children: "Account" }),
        /* @__PURE__ */ jsx11("h1", { children: "Settings" }),
        /* @__PURE__ */ jsx11("p", { children: "Preferences persist through the authenticated user-data service." })
      ] }),
      saving ? /* @__PURE__ */ jsxs9("span", { className: "xeno-saving", children: [
        /* @__PURE__ */ jsx11(LoaderCircle, { size: 15, className: "xeno-spin" }),
        "Saving"
      ] }) : null
    ] }),
    /* @__PURE__ */ jsx11(AccountSettingsNav_default, {}),
    error ? /* @__PURE__ */ jsx11("div", { className: "xeno-inline-error", role: "alert", children: error }) : null,
    notice ? /* @__PURE__ */ jsxs9("div", { className: "xeno-inline-success", role: "status", children: [
      /* @__PURE__ */ jsx11(Check, { size: 15 }),
      notice
    ] }) : null,
    /* @__PURE__ */ jsxs9("section", { className: "xeno-settings-grid", children: [
      /* @__PURE__ */ jsxs9("article", { id: "appearance", className: "xeno-settings-card", children: [
        /* @__PURE__ */ jsxs9("header", { children: [
          /* @__PURE__ */ jsx11(Settings, { size: 17 }),
          /* @__PURE__ */ jsxs9("span", { children: [
            /* @__PURE__ */ jsx11("h2", { children: "Appearance" }),
            /* @__PURE__ */ jsx11("p", { children: "One theme for the entire platform" })
          ] })
        ] }),
        /* @__PURE__ */ jsxs9("label", { children: [
          "Theme",
          /* @__PURE__ */ jsxs9("select", { value: theme, disabled: saving, onChange: (event) => {
            const nextTheme = event.target.value;
            void updateTheme(nextTheme, getPlatformThemePosition(nextTheme, themeBrightness));
          }, children: [
            /* @__PURE__ */ jsx11("option", { value: "system", children: "System" }),
            /* @__PURE__ */ jsx11("option", { value: "dark", children: "Dark" }),
            /* @__PURE__ */ jsx11("option", { value: "dim", children: "Dim" }),
            /* @__PURE__ */ jsx11("option", { value: "light", children: "Light" }),
            /* @__PURE__ */ jsx11("option", { value: "custom", children: "Custom" })
          ] })
        ] }),
        /* @__PURE__ */ jsxs9("label", { children: [
          "Theme brightness",
          /* @__PURE__ */ jsx11("input", { type: "range", min: "0", max: "100", step: "5", value: theme === "custom" ? themeBrightness : getPlatformThemePosition(theme, themeBrightness), disabled: saving, "aria-label": "Platform theme brightness", onChange: (event) => {
            const nextBrightness = normalizePlatformThemeBrightness(event.target.value);
            setSettings((current) => ({ ...current, appearance: { ...current.appearance, theme: "custom", themeBrightness: nextBrightness } }));
          }, onPointerUp: (event) => void updateTheme("custom", normalizePlatformThemeBrightness(event.currentTarget.value)), onKeyUp: (event) => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) void updateTheme("custom", normalizePlatformThemeBrightness(event.currentTarget.value));
          } })
        ] }),
        /* @__PURE__ */ jsxs9("label", { children: [
          "Interface font size",
          /* @__PURE__ */ jsxs9("select", { value: fontSize, disabled: saving, onChange: (event) => update("appearance.fontSize", event.target.value), children: [
            /* @__PURE__ */ jsx11("option", { value: "small", children: "Small" }),
            /* @__PURE__ */ jsx11("option", { value: "medium", children: "Medium" }),
            /* @__PURE__ */ jsx11("option", { value: "large", children: "Large" })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxs9("article", { id: "security", className: "xeno-settings-card", children: [
        /* @__PURE__ */ jsxs9("header", { children: [
          /* @__PURE__ */ jsx11(Lock, { size: 17 }),
          /* @__PURE__ */ jsxs9("span", { children: [
            /* @__PURE__ */ jsx11("h2", { children: "Password" }),
            /* @__PURE__ */ jsx11("p", { children: "Change with current-password verification" })
          ] })
        ] }),
        passwordOpen ? /* @__PURE__ */ jsxs9("div", { className: "xeno-form-stack", children: [
          /* @__PURE__ */ jsx11("input", { type: "password", value: currentPassword, onChange: (e) => setCurrentPassword(e.target.value), placeholder: "Current password" }),
          /* @__PURE__ */ jsx11("input", { type: "password", value: newPassword, onChange: (e) => setNewPassword(e.target.value), placeholder: "New password" }),
          /* @__PURE__ */ jsx11("input", { type: "password", value: confirmPassword, onChange: (e) => setConfirmPassword(e.target.value), placeholder: "Confirm new password" }),
          /* @__PURE__ */ jsxs9("div", { children: [
            /* @__PURE__ */ jsx11("button", { type: "button", className: "xeno-page-button", onClick: () => setPasswordOpen(false), children: "Cancel" }),
            /* @__PURE__ */ jsx11("button", { type: "button", className: "xeno-page-button is-primary", disabled: saving, onClick: changePassword, children: "Save password" })
          ] })
        ] }) : /* @__PURE__ */ jsx11("button", { type: "button", className: "xeno-page-button", onClick: () => setPasswordOpen(true), children: "Change password" })
      ] }),
      /* @__PURE__ */ jsxs9("article", { className: "xeno-settings-card is-danger", children: [
        /* @__PURE__ */ jsxs9("header", { children: [
          /* @__PURE__ */ jsx11(TriangleAlert, { size: 17 }),
          /* @__PURE__ */ jsxs9("span", { children: [
            /* @__PURE__ */ jsx11("h2", { children: "Delete account" }),
            /* @__PURE__ */ jsx11("p", { children: "Permanent authenticated operation" })
          ] })
        ] }),
        deleteOpen ? /* @__PURE__ */ jsxs9("div", { className: "xeno-form-stack", children: [
          /* @__PURE__ */ jsx11("input", { type: "password", value: deletePassword, onChange: (e) => setDeletePassword(e.target.value), placeholder: "Confirm your password" }),
          /* @__PURE__ */ jsxs9("div", { children: [
            /* @__PURE__ */ jsx11("button", { type: "button", className: "xeno-page-button", onClick: () => setDeleteOpen(false), children: "Cancel" }),
            /* @__PURE__ */ jsxs9("button", { type: "button", className: "xeno-page-button is-danger", disabled: saving, onClick: deleteAccount, children: [
              /* @__PURE__ */ jsx11(Trash2, { size: 14 }),
              "Delete permanently"
            ] })
          ] })
        ] }) : /* @__PURE__ */ jsx11("button", { type: "button", className: "xeno-page-button is-danger", onClick: () => setDeleteOpen(true), children: "Delete account" })
      ] })
    ] }),
    /* @__PURE__ */ jsxs9("section", { className: "xeno-data-card xeno-session-card", children: [
      /* @__PURE__ */ jsxs9("header", { children: [
        /* @__PURE__ */ jsxs9("div", { children: [
          /* @__PURE__ */ jsx11("h2", { children: "Active sessions" }),
          /* @__PURE__ */ jsx11("p", { children: "Devices currently authorized to use your account." })
        ] }),
        /* @__PURE__ */ jsxs9("button", { type: "button", className: "xeno-page-button", disabled: sessionsLoading, onClick: () => void loadSessions(), children: [
          /* @__PURE__ */ jsx11(RefreshCw, { size: 14 }),
          "Refresh"
        ] })
      ] }),
      sessionsLoading ? /* @__PURE__ */ jsx11(ResourceState_default, { kind: "loading", title: "Loading active sessions" }) : sessionsError ? /* @__PURE__ */ jsx11(ResourceState_default, { kind: "error", title: "Session service unavailable", detail: sessionsError, actionLabel: "Try again", onRetry: () => void loadSessions() }) : sessions.length ? sessions.map((session) => /* @__PURE__ */ jsxs9("article", { className: "xeno-session-row", children: [
        /* @__PURE__ */ jsx11("span", { className: "xeno-data-icon", children: /* @__PURE__ */ jsx11(Laptop, { size: 16 }) }),
        /* @__PURE__ */ jsxs9("span", { children: [
          /* @__PURE__ */ jsxs9("strong", { children: [
            session.browser || session.device_type || "Authorized session",
            session.current ? /* @__PURE__ */ jsxs9("em", { children: [
              /* @__PURE__ */ jsx11(ShieldCheck, { size: 12 }),
              "Current"
            ] }) : null
          ] }),
          /* @__PURE__ */ jsx11("small", { children: [session.os, session.ip_address].filter(Boolean).join(" \xB7 ") || session.user_agent || "Device details unavailable" }),
          /* @__PURE__ */ jsxs9("small", { children: [
            "Last active ",
            new Date(session.last_active_at || session.created_at).toLocaleString(),
            " \xB7 expires ",
            new Date(session.expires_at).toLocaleDateString()
          ] })
        ] }),
        /* @__PURE__ */ jsx11("button", { type: "button", className: "xeno-row-action", disabled: sessionBusy === session.id, onClick: () => void revokeSession(session), children: sessionBusy === session.id ? "Revoking\u2026" : session.current ? "Log out" : "Revoke" })
      ] }, session.id)) : /* @__PURE__ */ jsx11(ResourceState_default, { kind: "empty", title: "No active sessions", detail: "The server confirmed that this account has no active sessions." })
    ] }),
    sessionAction ? /* @__PURE__ */ jsx11(
      ActionDialog,
      {
        title: "Revoke session",
        detail: `Log out ${sessionAction.current ? "this session" : sessionAction.browser || sessionAction.device_type || "this device"}?`,
        confirmLabel: confirmedRevocation.current === sessionAction.id ? "Check revocation" : "Revoke session",
        destructive: true,
        onConfirm: () => confirmSessionRevocation(sessionAction),
        onClose: () => setSessionAction(null),
        recovery: sessionAction.current ? { label: "Sign in again", onRecover: () => {
          logout?.();
          navigate("/login");
        } } : void 0
      },
      sessionAction.id
    ) : null
  ] });
};
var SettingsPage_default = SettingsPage;
export {
  ActionDialog as Dialog,
  ProjectsPage_default as Projects,
  SettingsPage_default as Settings
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

lucide-react/dist/esm/icons/archive.js:
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

lucide-react/dist/esm/icons/calendar-days.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/check.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/circle-alert.js:
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

lucide-react/dist/esm/icons/inbox.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/laptop.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/layout-grid.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/list.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/loader-circle.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/lock.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/maximize-2.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/message-square.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/panel-right.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/panels-top-left.js:
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

lucide-react/dist/esm/icons/plus.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/refresh-cw.js:
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

lucide-react/dist/esm/icons/trash-2.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/triangle-alert.js:
  (**
   * @license lucide-react v0.479.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)

lucide-react/dist/esm/icons/user.js:
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
