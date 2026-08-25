import { startBrowser } from "./boot";
import { installImmediateInteractionFeedback } from "./performance-ux";
import "./styles.css";

installImmediateInteractionFeedback();
startBrowser();
