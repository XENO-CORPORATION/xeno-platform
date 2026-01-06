declare namespace JSX {
  interface IntrinsicElements {
    'model-viewer': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      src?: string;
      alt?: string;
      cameraControls?: boolean;
      autoRotate?: boolean;
      style?: React.CSSProperties;
      shadowIntensity?: string | number;
      exposure?: string | number;
      ar?: boolean;
      arModes?: string;
      loading?: string;
    };
  }
}
