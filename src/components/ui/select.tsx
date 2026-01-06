import React from 'react';

export const Select: React.FC<any> = ({ children, ...props }) => (
  <div {...props}>{children}</div>
);

export const SelectTrigger: React.FC<any> = ({ children, ...props }) => (
  <button {...props}>{children}</button>
);

export const SelectContent: React.FC<any> = ({ children, ...props }) => (
  <div {...props}>{children}</div>
);

export const SelectItem: React.FC<any> = ({ children, ...props }) => (
  <div {...props}>{children}</div>
);

export const SelectValue: React.FC<any> = ({ placeholder }) => (
  <span>{placeholder}</span>
);
