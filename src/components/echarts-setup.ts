/**
 * Tree-shaken ECharts setup for SSR.
 *
 * Import only the chart types and components Orrery needs.
 * Add new chart types here as post-MVP components are built.
 */

import * as echarts from "echarts/core";
import { LineChart, BarChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  SVGRenderer,
]);

export { echarts };
