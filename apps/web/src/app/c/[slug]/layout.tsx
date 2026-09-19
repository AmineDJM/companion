/**
 * The recipient viewer runs outside the product shell entirely: no header, no
 * navigation, no footer. The document is the interface.
 */
export default function ViewerLayout({ children }: { children: React.ReactNode }) {
  return <div className="isolate">{children}</div>;
}
