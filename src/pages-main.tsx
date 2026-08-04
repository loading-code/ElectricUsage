import { createRoot } from "react-dom/client";
import Home from "../app/page";
import "../app/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("The dashboard root element could not be found.");
}

createRoot(root).render(<Home />);
