import * as echarts from 'echarts/core';
import { LineChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, BrushComponent, MarkAreaComponent, MarkLineComponent, ToolboxComponent, AxisPointerComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, BrushComponent, MarkAreaComponent, MarkLineComponent, ToolboxComponent, AxisPointerComponent, CanvasRenderer]);
export { echarts };
export type { EChartsType } from 'echarts/core';
