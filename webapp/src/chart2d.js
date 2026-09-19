import * as echarts from "echarts";
import { toolbar, saveImage } from "./rendering.js";
const palette = ["#087f83", "#466bb0", "#dc7358", "#d89c27"];
const finite = (x) => typeof x === "number" && Number.isFinite(x);
function append(target, values) {
  for (const value of values) target.push(value);
}
function finiteMaximum(values, fallback = 0.001) {
  let maximum = fallback;
  for (const value of values)
    if (finite(value) && value > maximum) maximum = value;
  return maximum;
}
function extent(values) {
  const a = values.filter(finite);
  if (!a.length) return [0, 1];
  let lo = Infinity,
    hi = -Infinity;
  for (const x of a) {
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  const gap = (hi - lo || Math.max(Math.abs(lo) * 0.1, 1)) * 0.08;
  return [lo - gap, hi + gap];
}
export class Chart2D {
  constructor(host) {
    this.host = host;
    host.classList.add("research-view", "chart-view");
    this.surface = document.createElement("div");
    this.surface.className = "chart-surface";
    host.append(this.surface);
    this.chart = echarts.init(this.surface, null, { renderer: "canvas" });
    this.bar = toolbar(
      host,
      () => this.focus(null),
      () =>
        saveImage(
          this.chart.getDataURL({ pixelRatio: 2, backgroundColor: "#ffffff" }),
          `${host.id}.png`,
        ),
    );
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.surface.ondblclick = () => this.focus(null);
    this.chart.on("datazoom", () => {
      this.zoom = this.chart
        .getOption()
        .dataZoom.map(({ start, end }) => ({ start, end }));
      this.host.dataset.zoom = JSON.stringify(this.zoom);
    });
  }
  update(data, layout) {
    if (this.layout?.xaxis?.title?.text !== layout.xaxis?.title?.text) {
      this.bounds = null;
      this.zoom = null;
    }
    this.data = data;
    this.layout = layout;
    this.draw();
  }
  draw() {
    if (!this.data) return;
    const data = this.data,
      layout = this.layout;
    const heat = data.find((d) => d.type === "heatmap");
    const bar = data.find((d) => d.type === "bar");
    const equal = layout.yaxis?.scaleanchor === "x";
    const series = [];
    let xx = [],
      yy = [];
    for (const [i, d] of data.entries()) {
      const color =
        d.line?.color || d.marker?.color || palette[i % palette.length];
      if (d.type === "heatmap") {
        const cells = [];
        d.y.forEach((_, y) =>
          d.x.forEach((_, x) => {
            if (finite(d.z[y][x]))
              cells.push([x, y, d.z[y][x], d.meta?.[y]?.[x]]);
          }),
        );
        series.push({
          type: "heatmap",
          name: "Deviation",
          data: cells,
          progressive: 0,
          emphasis: { itemStyle: { borderColor: "#243941", borderWidth: 1 } },
        });
      } else if (d.type === "histogram") {
        const values = d.x.filter(finite),
          bounds = extent(values),
          count = d.nbinsx || 40;
        const step = (bounds[1] - bounds[0]) / count,
          bins = Array(count).fill(0);
        for (const v of values)
          bins[
            Math.min(count - 1, Math.max(0, Math.floor((v - bounds[0]) / step)))
          ]++;
        const pts = bins.map((n, j) => [bounds[0] + (j + 0.5) * step, n]);
        for (const [x, y] of pts) {
          xx.push(x);
          yy.push(y);
        }
        series.push({
          type: "bar",
          name: "Points",
          data: pts,
          barWidth: "95%",
          itemStyle: { color, borderRadius: [3, 3, 0, 0] },
        });
      } else if (d.type === "bar") {
        append(yy, d.y);
        series.push({
          type: "bar",
          name: "RMSE",
          data: d.y.map((value, j) => ({
            value,
            itemStyle: { color: Array.isArray(color) ? color[j] : color },
          })),
          barMaxWidth: 80,
          itemStyle: { borderRadius: [8, 8, 0, 0] },
          label: {
            show: true,
            position: "top",
            formatter: (p) => Number(p.value).toPrecision(4),
            color: "#405460",
          },
        });
      } else {
        const pts = d.x.map((x, j) => [x, d.y[j]]);
        append(xx, d.x);
        append(yy, d.y);
        series.push({
          type: d.mode === "markers" ? "scatter" : "line",
          name: d.name || `Outline ${i + 1}`,
          data: pts,
          showSymbol: d.mode?.includes("markers"),
          symbolSize: d.marker?.size || 5,
          smooth: false,
          connectNulls: false,
          clip: true,
          silent: d.hoverinfo === "skip",
          itemStyle: { color },
          lineStyle: {
            color,
            width: d.line?.width || 2.5,
            type:
              d.line?.dash === "dot"
                ? "dotted"
                : d.line?.dash
                  ? "dashed"
                  : "solid",
          },
          emphasis: { focus: "series" },
        });
      }
    }
    let xr = this.bounds?.x || layout.xaxis?.range || extent(xx),
      yr = this.bounds?.y || layout.yaxis?.range || extent(yy);
    if (
      !this.bounds &&
      (layout.yaxis?.rangemode === "tozero" ||
        bar ||
        data[0]?.type === "histogram")
    )
      yr = [Math.min(0, ...yy.filter(finite)), yr[1]];
    // Equal-scale ray views size the frame from the requested data spans. This
    // preserves one millimetre per visual unit without widening an axis merely
    // because its surrounding card is wide.
    const axis = (name) => ({
      type: "value",
      name,
      nameLocation: "middle",
      nameGap: 28,
      nameTextStyle: { color: "#657580", fontSize: 11 },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: "#657580",
        fontSize: 10,
        formatter: (v) => Number(v.toPrecision(4)).toString(),
        hideOverlap: true,
        showMinLabel: !equal,
        showMaxLabel: false,
      },
      splitLine: { lineStyle: { color: "#eaf0f2", type: "dashed" } },
      splitNumber: 4,
    });
    const equalFrame = (() => {
      if (!equal) return null;
      const availableWidth = Math.max(120, this.host.clientWidth - 96),
        availableHeight = Math.max(120, this.host.clientHeight - 62),
        aspect = Math.max(0.1, (xr[1] - xr[0]) / (yr[1] - yr[0]));
      let width = availableWidth,
        height = width / aspect;
      if (height > availableHeight) {
        height = availableHeight;
        width = height * aspect;
      }
      return { width, height };
    })();
    const option = {
      animation: false,
      backgroundColor: "#fff",
      color: palette,
      textStyle: {
        fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      },
      grid: equal
        ? {
            width: equalFrame.width,
            height: equalFrame.height,
            left: Math.max(64, (this.host.clientWidth - equalFrame.width) / 2),
            top: 10,
          }
        : {
            left: 64,
            right: heat ? 64 : 24,
            top: layout.showlegend ? 38 : 20,
            bottom: 66,
          },
      tooltip: {
        trigger: equal || heat ? "item" : "axis",
        renderMode: "richText",
        confine: true,
        backgroundColor: "#ffffff",
        borderColor: "#dce5e8",
        textStyle: { color: "#233740", fontSize: 12 },
        valueFormatter: (v) => (finite(v) ? Number(v).toPrecision(5) : v),
      },
      xAxis: {
        ...axis(layout.xaxis?.title?.text || ""),
        min: xr[0],
        max: xr[1],
      },
      yAxis: {
        ...axis(layout.yaxis?.title?.text || ""),
        min: yr[0],
        max: yr[1],
        inverse: layout.yaxis?.autorange === "reversed",
      },
      legend: {
        show: layout.showlegend === true,
        top: 2,
        left: 58,
        itemWidth: 16,
        itemHeight: 3,
        textStyle: { color: "#526570", fontSize: 11 },
      },
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: 0,
          filterMode: "none",
          preventDefaultMouseMove: true,
        },
        {
          type: "inside",
          yAxisIndex: 0,
          filterMode: "none",
          preventDefaultMouseMove: true,
        },
      ],
      series,
    };
    if (layout.shapes?.length && series[0])
      series[0].markArea = {
        silent: true,
        itemStyle: { color: "rgba(226,185,82,.12)" },
        data: layout.shapes.map((s) => [{ xAxis: s.x0 }, { xAxis: s.x1 }]),
      };
    if (bar)
      option.xAxis = {
        ...axis(layout.xaxis?.title?.text),
        type: "category",
        data: bar.x,
        axisLabel: { color: "#657580", fontSize: 11 },
        splitLine: { show: false },
      };
    if (heat) {
      const vals = series[0].data.map((p) => p[2]);
      option.xAxis = {
        ...axis(layout.xaxis?.title?.text),
        type: "category",
        data: heat.x,
        axisLabel: {
          color: "#657580",
          interval: Math.max(0, Math.ceil(heat.x.length / 7) - 1),
          formatter: (value) => Number(Number(value).toPrecision(4)).toString(),
        },
        splitLine: { show: false },
      };
      option.yAxis = {
        ...axis(layout.yaxis?.title?.text),
        type: "category",
        data: heat.y,
        inverse: true,
        axisLabel: {
          color: "#657580",
          interval: Math.max(0, Math.ceil(heat.y.length / 7) - 1),
          formatter: (value) => Number(Number(value).toPrecision(4)).toString(),
        },
        splitLine: { show: false },
      };
      option.visualMap = {
        dimension: 2,
        min: 0,
        max: finiteMaximum(vals),
        calculable: false,
        orient: "vertical",
        right: 0,
        top: "middle",
        itemHeight: 130,
        itemWidth: 8,
        text: [heat.colorbar?.title?.text || "", "0"],
        inRange: { color: heat.colorscale.map((p) => p[1]) },
        textStyle: { color: "#657580" },
      };
      option.tooltip.formatter = (p) =>
        heat.hover
          ? heat.hover(
              heat.x[p.value[0]],
              heat.y[p.value[1]],
              p.value[2],
              p.value[3],
            )
          : `X ${heat.x[p.value[0]]}\u00b0\nY ${heat.y[p.value[1]]}\u00b0\nValue ${p.value[2].toFixed(5)}\u00b0`;
    }
    if (this.zoom)
      option.dataZoom.forEach((z, i) => Object.assign(z, this.zoom[i]));
    this.chart.setOption(option, { notMerge: true });
    this.host.dataset.bounds = JSON.stringify({ x: xr, y: yr });
    if (equal) this.host.dataset.frame = JSON.stringify(equalFrame);
    this.host.dataset.points = String(
      series.reduce((n, s) => n + s.data.length, 0),
    );
  }
  focus(bounds) {
    this.bounds = bounds;
    this.zoom = null;
    this.draw();
  }
  resize() {
    if (this.host.clientWidth && this.host.clientHeight) {
      this.chart.resize();
      if (this.layout?.yaxis?.scaleanchor) this.draw();
    }
  }
  dispose() {
    this.observer.disconnect();
    this.chart.dispose();
    this.host.replaceChildren();
  }
}
