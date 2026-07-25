import React from 'react';

export const AnimatePresence = ({ children }) => children;
export const useReducedMotion = () => true;

const stripMotionProps = (props) => {
  const {
    animate: _animate,
    custom: _custom,
    exit: _exit,
    initial: _initial,
    transition: _transition,
    variants: _variants,
    ...elementProps
  } = props;

  return elementProps;
};

const createMotion = (tag) => {
  const Component = React.forwardRef((props, ref) =>
    React.createElement(tag, { ...stripMotionProps(props), ref }),
  );
  Component.displayName = `Motion${tag[0].toUpperCase()}${tag.slice(1)}`;
  return Component;
};

export const motion = {
  article: createMotion('article'),
  div: createMotion('div'),
  span: createMotion('span'),
  p: createMotion('p'),
  line: createMotion('line'),
};
