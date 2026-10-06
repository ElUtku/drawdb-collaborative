import ReactDOM from "react-dom/client";
import { LocaleProvider } from "@douyinfe/semi-ui";
import "bootstrap-icons/font/bootstrap-icons.css";
import "@fortawesome/fontawesome-free/css/all.min.css";
import App from "./App.jsx";
import en_US from "@douyinfe/semi-ui/lib/es/locale/source/en_US";
import "./index.css";
import { i18nReady } from "./i18n/i18n.js";

const root = ReactDOM.createRoot(document.getElementById("root"));

// Waiting on the detected language keeps non-English users from seeing a frame
// of English while their translation chunk arrives.
i18nReady
  .catch(() => {})
  .then(() => {
    root.render(
      <LocaleProvider locale={en_US}>
        <App />
      </LocaleProvider>,
    );
  });
