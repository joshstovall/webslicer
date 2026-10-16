import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider, createTheme } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/manrope/latin-800.css";
import "./styles.css";
import App from "./App";
const theme = createTheme({
  primaryColor: "forest",
  colors: {
    forest: [
      "#eef5eb",
      "#dce9d5",
      "#b8d1ac",
      "#95b884",
      "#769f63",
      "#5e884b",
      "#4b703d",
      "#3c5b32",
      "#30492b",
      "#264025",
    ],
  },
  fontFamily:
    'DM Sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontSizes: { xs: "11px", sm: "13px", md: "14px" },
  defaultRadius: "md",
  primaryShade: 8,
  components: {
    Button: { defaultProps: { fw: 600 } },
    Modal: {
      defaultProps: {
        centered: true,
        overlayProps: { backgroundOpacity: 0.25, blur: 5 },
      },
    },
    Tooltip: { defaultProps: { withArrow: true, openDelay: 400 } },
    NumberInput: { defaultProps: { allowLeadingZeros: false } },
    Select: { defaultProps: { checkIconPosition: "right" } },
  },
});
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MantineProvider theme={theme}>
      <Notifications position="top-right" />
      <App />
    </MantineProvider>
  </React.StrictMode>,
);
