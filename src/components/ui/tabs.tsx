import React, { createContext, useContext, useState } from 'react';

interface TabsContextType {
  value: string;
  onValueChange: (value: string) => void;
}

const TabsContext = createContext<TabsContextType | undefined>(undefined);

function useTabs() {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error("Tabs components must be used within a Tabs provider");
  }
  return context;
}

interface TabsProps {
  defaultValue: string;
  className?: string;
  children: React.ReactNode;
  onValueChange?: (value: string) => void;
}

export function Tabs({ defaultValue, className = "", children, onValueChange }: TabsProps) {
  const [value, setValue] = useState(defaultValue);

  const handleValueChange = (newValue: string) => {
    setValue(newValue);
    onValueChange?.(newValue);
  };

  return (
    <TabsContext.Provider value={{ value, onValueChange: handleValueChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

interface TabsListProps {
  className?: string;
  children: React.ReactNode;
}

export function TabsList({ className = "", children }: TabsListProps) {
  return (
    <div className={`inline-flex items-center justify-center p-0 ${className}`}>
      {children}
    </div>
  );
}

interface TabsTriggerProps {
  value: string;
  className?: string;
  children: React.ReactNode;
}

export function TabsTrigger({ value, className = "", children }: TabsTriggerProps) {
  const { value: selectedValue, onValueChange } = useTabs();
  const isSelected = selectedValue === value;

  return (
    <button
      className={`inline-flex items-center justify-center whitespace-nowrap px-5 py-3 text-sm font-medium transition-all border-b-2 focus:outline-none
        ${isSelected 
          ? 'text-white border-white' 
          : 'text-white/50 border-transparent hover:text-white/80'} 
        ${className}`}
      onClick={() => onValueChange(value)}
    >
      {children}
    </button>
  );
}

interface TabsContentProps {
  value: string;
  className?: string;
  children: React.ReactNode;
}

export function TabsContent({ value, className = "", children }: TabsContentProps) {
  const { value: selectedValue } = useTabs();
  const isSelected = selectedValue === value;

  if (!isSelected) return null;

  return (
    <div 
      className={`outline-none focus:outline-none transition-all duration-300 ${className}`}
      style={{ 
        opacity: isSelected ? 1 : 0,
        transform: isSelected ? 'translateY(0)' : 'translateY(4px)'
      }}
    >
      {children}
    </div>
  );
} 