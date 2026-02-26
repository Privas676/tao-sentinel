import { LineChart, Line, ResponsiveContainer } from "recharts";

const COLOR_MAP: Record<string, string> = {
  GO: "hsl(var(--signal-go))",
  EARLY: "hsl(var(--signal-go-spec))",
  BREAK: "hsl(var(--signal-exit))",
};

export function SentinelSparkline({ data, state }: { data: number[]; state: string | null }) {
  if (!data.length) return <div className="w-[70px] h-[24px]" />;
  const chartData = data.map((v, i) => ({ v, i }));
  const color = COLOR_MAP[state || ""] || "hsl(var(--muted-foreground))";

  return (
    <div className="w-[70px] h-[24px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <defs>
            <filter id={`glow-${state}`}>
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            dot={false}
            strokeWidth={1.5}
            isAnimationActive={false}
            filter={state === "GO" || state === "EARLY" || state === "BREAK" ? `url(#glow-${state})` : undefined}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
