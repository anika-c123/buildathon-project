import Control from "./Control.jsx";
import Desk from "./Desk.jsx";

// Two pages, picked by the URL path: "/" is the laptop control screen,
// "/desk" is the full-screen view dragged onto the projector.
export default function App() {
  return window.location.pathname === "/desk" ? <Desk /> : <Control />;
}
