// src/components/platform/confirmAction.tsx
import { useEffect as useEffect3, useState as useState2 } from "react";

// src/components/platform/ActionDialog.tsx
import { useEffect as useEffect2, useId as useId2, useRef as useRef3, useState } from "react";

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

// packages/elements-react/src/useDialog.ts
import { useCallback, useEffect, useRef } from "react";
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
  const ownRef = useRef(null);
  const panelRef = providedRef ?? ownRef;
  const restoreFocus = useRef(null);
  useEffect(() => {
    if (!open || !onClose) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  useEffect(() => {
    if (!open || !lockScroll) return;
    lockPageScroll();
    return unlockPageScroll;
  }, [open, lockScroll]);
  const focusedOnce = useRef(false);
  const openRef = useRef(open);
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
  useEffect(() => {
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

// packages/elements-react/src/controls/IconButton.tsx
import { forwardRef as forwardRef2 } from "react";
import { jsx as jsx3 } from "react/jsx-runtime";
var IconButton = forwardRef2(function IconButton2({
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
  return /* @__PURE__ */ jsx3(
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
      children: /* @__PURE__ */ jsx3(XenoElement, { decl: icon, size: iconSize ?? iconPx(size), ...iconState ? { state: iconState } : {} })
    }
  );
});

// packages/elements-react/src/controls/TextInput.tsx
import { jsx as jsx4, jsxs as jsxs2 } from "react/jsx-runtime";
function TextInput({
  size = "md",
  leadingIcon,
  iconSize,
  fontSize,
  disabled = false,
  className,
  ...rest
}) {
  return /* @__PURE__ */ jsxs2(
    "div",
    {
      className: cx("xeno-input", className),
      "data-availability": disabled ? "disabled" : "enabled",
      style: fontSize === void 0 ? void 0 : { "--xeno-font": `${fontSize}px` },
      ...sizeAttr(size),
      children: [
        leadingIcon && /* @__PURE__ */ jsx4("span", { className: "xeno-input-icon", "aria-hidden": "true", children: /* @__PURE__ */ jsx4(XenoElement, { decl: leadingIcon, size: iconSize ?? iconPx(size) }) }),
        /* @__PURE__ */ jsx4("input", { className: "xeno-input-field", disabled, ...rest })
      ]
    }
  );
}

// packages/elements/src/elements/x.ts
var X = {
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
var x_default = X;

// packages/elements-react/src/overlays/Modal.tsx
import { useCallback as useCallback2, useId, useRef as useRef2 } from "react";
import { jsx as jsx5, jsxs as jsxs3 } from "react/jsx-runtime";
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
  const scrimArmed = useRef2(false);
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
  return /* @__PURE__ */ jsx5(
    "div",
    {
      className: "xeno-modal-overlay",
      "data-variant": variant,
      onMouseDown: onScrimMouseDown,
      onClick: onScrimClick,
      children: /* @__PURE__ */ jsxs3(
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
            /* @__PURE__ */ jsxs3("div", { className: "xeno-modal-header", children: [
              title !== void 0 ? /* @__PURE__ */ jsx5("h2", { id: titleId, className: "xeno-modal-title", children: title }) : null,
              /* @__PURE__ */ jsx5(
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
            /* @__PURE__ */ jsx5("div", { className: "xeno-modal-body", children }),
            footer !== void 0 ? /* @__PURE__ */ jsx5("div", { className: "xeno-modal-footer", children: footer }) : null
          ]
        }
      )
    }
  );
}

// fixture:platformTheme
var usePlatformTheme = () => ({ resolvedTheme: "dark", themeStyle: {} });

// src/components/platform/ActionDialog.tsx
import { Fragment, jsx as jsx6, jsxs as jsxs4 } from "react/jsx-runtime";
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
  const [value, setValue] = useState(initialValue);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef3(false);
  const mounted = useRef3(true);
  const { resolvedTheme, themeStyle } = usePlatformTheme();
  useEffect2(() => {
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
  return /* @__PURE__ */ jsx6("div", { className: "xeno chat-themed", "data-theme": resolvedTheme, "data-style": "industrial", style: themeStyle, children: /* @__PURE__ */ jsx6(
    Modal,
    {
      open: true,
      title,
      onClose: close,
      dismissDisabled: pending,
      "aria-busy": pending,
      "aria-describedby": detailId,
      footer: /* @__PURE__ */ jsxs4(Fragment, { children: [
        /* @__PURE__ */ jsx6(Button, { onClick: close, disabled: pending, children: "Cancel" }),
        error && recovery ? /* @__PURE__ */ jsx6(Button, { variant: "primary", onClick: recovery.onRecover, children: recovery.label }) : /* @__PURE__ */ jsx6(
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
      children: /* @__PURE__ */ jsxs4("form", { id: formId, onSubmit: submit, children: [
        /* @__PURE__ */ jsx6("p", { id: detailId, children: detail }),
        choices ? /* @__PURE__ */ jsxs4("fieldset", { disabled: pending, style: { border: 0, margin: 0, padding: 0 }, children: [
          fieldLabel ? /* @__PURE__ */ jsx6("legend", { children: fieldLabel }) : null,
          choices.map((choice) => /* @__PURE__ */ jsxs4(
            "label",
            {
              htmlFor: `${fieldId}-${choice.value}`,
              style: { display: "flex", alignItems: "center", gap: "8px", padding: "4px 0" },
              children: [
                /* @__PURE__ */ jsx6(
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
                /* @__PURE__ */ jsx6("span", { children: choice.label })
              ]
            },
            choice.value
          ))
        ] }) : null,
        !choices && fieldLabel ? /* @__PURE__ */ jsxs4("label", { htmlFor: fieldId, children: [
          fieldLabel,
          /* @__PURE__ */ jsx6(
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
        pending ? /* @__PURE__ */ jsx6("p", { role: "status", children: "Waiting for the server to confirm this operation." }) : null,
        error ? /* @__PURE__ */ jsxs4("p", { role: "alert", children: [
          error,
          recovery ? " Sign in again to check the outcome; revocation was not confirmed." : ""
        ] }) : null
      ] })
    }
  ) });
}

// src/components/platform/confirmAction.tsx
import { jsx as jsx7 } from "react/jsx-runtime";
var nextId = 1;
var publish = null;
var queue = [];
function enqueue(pending) {
  queue.push(pending);
  if (!publish) {
    queue.pop();
    if (false) {
      console.error("[confirmAction] no <ConfirmActionHost /> is mounted \u2014 treating as cancelled:", pending.title);
    }
    pending.resolve(null);
    return;
  }
  if (queue.length === 1) publish(pending);
}
var settledId = 0;
function settle(id, value) {
  if (id === settledId) return;
  if (queue[0]?.id !== id) return;
  settledId = id;
  const current = queue.shift();
  current?.resolve(value);
  publish?.(queue[0] ?? null);
}
function confirmAction(options) {
  return new Promise((resolve) => enqueue({
    id: nextId++,
    title: options.title,
    detail: options.detail,
    confirmLabel: options.confirmLabel ?? "Confirm",
    destructive: options.destructive ?? false,
    resolve: (value) => resolve(value !== null)
  }));
}
function promptAction(options) {
  return new Promise((resolve) => enqueue({
    id: nextId++,
    title: options.title,
    detail: options.detail,
    confirmLabel: options.confirmLabel ?? "Save",
    destructive: options.destructive ?? false,
    fieldLabel: options.fieldLabel,
    initialValue: options.initialValue ?? "",
    choices: options.choices,
    resolve
  }));
}
function ConfirmActionHost() {
  const [pending, setPending] = useState2(null);
  useEffect3(() => {
    publish = setPending;
    return () => {
      publish = null;
    };
  }, []);
  if (!pending) return null;
  return /* @__PURE__ */ jsx7(
    ActionDialog,
    {
      title: pending.title,
      detail: pending.detail,
      confirmLabel: pending.confirmLabel,
      destructive: pending.destructive,
      fieldLabel: pending.fieldLabel,
      initialValue: pending.initialValue,
      choices: pending.choices,
      onConfirm: async (value) => {
        settle(pending.id, pending.fieldLabel || pending.choices ? value : "");
      },
      onClose: () => settle(pending.id, null)
    },
    pending.id
  );
}
export {
  ConfirmActionHost,
  confirmAction,
  promptAction
};
