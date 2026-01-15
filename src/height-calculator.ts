/**
 * Height calculator for built-in components
 * Returns ideal height in terminal rows based on component type and args
 */

import { readFileSync } from "fs";

type HeightCalculator = (args: Record<string, string>) => number;

const calculators: Record<string, HeightCalculator> = {
  chart: (args) => {
    try {
      let dataLength = 5;
      if (args.data) {
        const parsed = JSON.parse(args.data);
        dataLength = Array.isArray(parsed) ? parsed.length : 5;
      } else if (args.file) {
        const content = readFileSync(args.file, "utf-8");
        const parsed = JSON.parse(content);
        dataLength = Array.isArray(parsed) ? parsed.length : 5;
      }
      return Math.min(20, Math.max(6, dataLength + 2));
    } catch {
      return 10;
    }
  },

  gauge: (args) => {
    try {
      let gaugeCount = 1;
      if (args.data) {
        const parsed = JSON.parse(args.data);
        gaugeCount = Array.isArray(parsed) ? parsed.length : 1;
      }
      return Math.min(15, Math.max(5, gaugeCount * 3 + 2));
    } catch {
      return 6;
    }
  },

  select: (args) => {
    try {
      let itemCount = 5;
      const items = args.items || args.options;
      if (items) {
        try {
          const parsed = JSON.parse(items);
          itemCount = Array.isArray(parsed) ? parsed.length : 5;
        } catch {
          itemCount = items.split(",").length;
        }
      } else if (args.file) {
        const content = readFileSync(args.file, "utf-8");
        const parsed = JSON.parse(content);
        itemCount = Array.isArray(parsed) ? parsed.length : 5;
      }
      const searchRows = args.search === "true" ? 2 : 0;
      return Math.min(20, Math.max(6, itemCount + searchRows + 2));
    } catch {
      return 10;
    }
  },

  checklist: (args) => {
    try {
      const items = args.items || "";
      const itemCount = items.split(",").filter(Boolean).length;
      return Math.min(20, Math.max(6, itemCount + 3));
    } catch {
      return 10;
    }
  },

  progress: (args) => {
    try {
      const steps = args.steps || "";
      const stepCount = steps.split(",").filter(Boolean).length;
      return Math.min(15, Math.max(5, stepCount + 3));
    } catch {
      return 8;
    }
  },

  confirm: () => 5,  // fixed: question + buttons + padding
  tree: () => 15,    // scrollable
  json: () => 15,    // scrollable
  table: () => 18,   // scrollable with header
  code: () => 20,    // file viewer
  diff: () => 20,    // file comparison
  markdown: () => 20,
  mermaid: () => 15,
  "plan-viewer": () => 20,
  ask: () => 12,
};

/**
 * Get ideal height in rows for a component
 */
export function getComponentHeight(
  componentName: string,
  args: Record<string, string>
): number {
  const calculator = calculators[componentName];
  if (calculator) {
    return calculator(args);
  }
  return 15; // default for unknown components
}

/**
 * Convert row count to percentage of terminal height
 */
export function rowsToPercent(rows: number, terminalRows: number): number {
  const percent = Math.round((rows / terminalRows) * 100);
  return Math.min(80, Math.max(10, percent)); // clamp 10-80%
}
