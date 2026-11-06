import { Button } from "@labscape/ui";
import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <div className="font-heading text-8xl font-bold text-white/10">404</div>
      <h1 className="-mt-6 font-heading text-2xl font-bold">This beaker is empty</h1>
      <p className="mt-2 text-white/55">The page you're looking for isn't on the bench.</p>
      <Link to="/"><Button className="mt-6">Back to the dashboard</Button></Link>
    </div>
  );
}
