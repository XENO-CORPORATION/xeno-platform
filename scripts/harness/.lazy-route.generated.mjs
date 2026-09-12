// src/components/platform/lazyRoute.tsx
import React, { Suspense, useMemo, useState } from "react";

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
import { jsx } from "react/jsx-runtime";
var Shape = (s, i, morph) => {
  const paint = s.fill !== void 0 ? { fill: s.fill, stroke: "none" } : {};
  if (s.kind === "rect") {
    return /* @__PURE__ */ jsx("rect", { className: "xeno-part", "data-part": i, x: s.x, y: s.y, width: s.w, height: s.h, rx: s.rx, ...paint }, i);
  }
  const morphStyle = morph ? { "--part-d": `path('${s.d}')` } : void 0;
  return /* @__PURE__ */ jsx("path", { className: "xeno-part", "data-part": i, d: s.d, fillRule: s.fillRule, style: morphStyle, ...paint }, i);
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
  return /* @__PURE__ */ jsx(
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

// packages/elements-react/src/controls/Button.tsx
import { forwardRef } from "react";

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
import { jsx as jsx2, jsxs } from "react/jsx-runtime";
var Button = forwardRef(function Button2({
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
  return /* @__PURE__ */ jsxs(
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
        leadingIcon && /* @__PURE__ */ jsx2(XenoElement, { decl: leadingIcon, size: glyph }),
        revealSide ? /* @__PURE__ */ jsx2("span", { className: "xeno-btn-label", children }) : children,
        trailingIcon && /* @__PURE__ */ jsx2(XenoElement, { decl: trailingIcon, size: glyph })
      ]
    }
  );
});

// packages/elements-react/src/containers/Card.tsx
import { jsx as jsx3, jsxs as jsxs2 } from "react/jsx-runtime";
function Card({
  variant = "flat",
  interactive = false,
  lift = "subtle",
  header,
  footer,
  className,
  children,
  ...rest
}) {
  return /* @__PURE__ */ jsxs2(
    "div",
    {
      className: cx("xeno-card", className),
      "data-variant": variant,
      "data-interactive": interactive ? "true" : "false",
      "data-lift": lift,
      ...rest,
      children: [
        header !== void 0 && /* @__PURE__ */ jsx3("div", { className: "xeno-card-header", children: header }),
        /* @__PURE__ */ jsx3("div", { className: "xeno-card-body", children }),
        footer !== void 0 && /* @__PURE__ */ jsx3("div", { className: "xeno-card-footer", children: footer })
      ]
    }
  );
}

// packages/elements-react/src/status/ProgressBar.tsx
import { jsx as jsx4, jsxs as jsxs3 } from "react/jsx-runtime";
function ProgressBar({ value, label, className, ...rest }) {
  const indeterminate = value === null;
  const safe = value !== null && Number.isFinite(value) ? value : 0;
  const fraction = Math.min(1, Math.max(0, safe));
  const pct = Math.round(fraction * 100);
  const widthPct = Math.round(fraction * 1e3) / 10;
  return /* @__PURE__ */ jsxs3("div", { className: cx("xeno-progressbar", className), ...rest, children: [
    label !== void 0 && /* @__PURE__ */ jsxs3("div", { className: "xeno-progressbar-header", "aria-hidden": "true", children: [
      /* @__PURE__ */ jsx4("span", { className: "xeno-progressbar-label", children: label }),
      /* @__PURE__ */ jsx4("span", { className: "xeno-progressbar-value", children: indeterminate ? "\u2014" : `${pct}%` })
    ] }),
    /* @__PURE__ */ jsx4(
      "span",
      {
        role: "progressbar",
        ...indeterminate ? {} : { "aria-valuenow": pct },
        "aria-valuemin": 0,
        "aria-valuemax": 100,
        "aria-label": label !== void 0 ? label : "Progress",
        className: "xeno-progressbar-track",
        "data-state": indeterminate ? "indeterminate" : "determinate",
        children: /* @__PURE__ */ jsx4(
          "span",
          {
            className: "xeno-progressbar-fill",
            ...indeterminate ? {} : { style: { width: `${widthPct}%` } }
          }
        )
      }
    )
  ] });
}

// src/components/platform/lazyRoute.tsx
import { Fragment, jsx as jsx5, jsxs as jsxs4 } from "react/jsx-runtime";
var RouteLoadBoundary = class extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return /* @__PURE__ */ jsx5(Card, { className: "xeno", role: "alert", header: "This page could not load", footer: /* @__PURE__ */ jsxs4(Fragment, { children: [
      /* @__PURE__ */ jsx5(Button, { variant: "secondary", onClick: this.props.onRetry, autoFocus: true, children: "Try again" }),
      /* @__PURE__ */ jsx5(Button, { variant: "ghost", onClick: () => window.location.reload(), children: "Reload page" })
    ] }), children: /* @__PURE__ */ jsx5("p", { children: "Check your connection and try again. If the platform was updated, reload this page. Reloading may discard unsaved changes." }) });
  }
};
function lazyRoute(load) {
  return function LazyRoute(props) {
    const [attempt, setAttempt] = useState(0);
    const Component = useMemo(() => React.lazy(load), [attempt]);
    return /* @__PURE__ */ jsx5(RouteLoadBoundary, { onRetry: () => setAttempt((value) => value + 1), children: /* @__PURE__ */ jsx5(Suspense, { fallback: /* @__PURE__ */ jsx5(Card, { className: "xeno", role: "status", "aria-busy": "true", children: /* @__PURE__ */ jsx5(ProgressBar, { value: null, label: "Loading page" }) }), children: /* @__PURE__ */ jsx5(Component, { ...props }) }) }, attempt);
  };
}
export {
  lazyRoute
};
