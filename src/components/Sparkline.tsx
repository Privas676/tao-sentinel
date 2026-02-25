import { LineChart, Line, ResponsiveContainer } from "recharts";

interface SparklineProps {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}

export function Sparkline({ data, color = "hsl(var(--primary))", width = 60, height = 20 }: SparklineProps) {
  if (!data.length) return null;

  const chartData = data.map((v, i) => ({ v, i }));
  const isUp = data[data.length - 1] >= data[0];
  const strokeColor = color === "auto"
    ? isUp ? "hsl(var(--signal-go))" : "hsl(var(--signal-exit))"
    : color;

  return (
    <div style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <Line
            type="monotone"
            dataKey="v"
            stroke={strokeColor}
            dot={false}
            strokeWidth={1.2}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
