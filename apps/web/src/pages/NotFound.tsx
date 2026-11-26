import { Blob, Button } from "@labscape/ui";
import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="relative mx-auto max-w-xl overflow-hidden rounded-panel bg-card px-6 py-20 text-center">
      <Blob shape="hex" color="#FFBDF9" size={180} rotate={10} className="absolute -left-12 -top-16" />
      <Blob shape="cloud" color="#48F08B" size={200} className="absolute -bottom-20 -right-14" />
      <div className="relative">
        <div aria-hidden className="font-heading text-[96px] font-normal leading-none tracking-[-0.04em] text-ink/15">404</div>
        <h1 className="mt-2 font-heading text-[32px] font-normal tracking-[-0.02em] text-ink-strong">This beaker is empty</h1>
        <p className="mt-2 text-ink-muted">The page you're looking for isn't on the bench.</p>
        <Link to="/"><Button className="mt-7">Back to the dashboard</Button></Link>
      </div>
    </div>
  );
}
