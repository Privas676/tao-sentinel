import type { ReactNode } from "react";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  width?: string;
  align?: "left" | "center" | "right";
  sticky?: boolean;
  render: (row: T, index: number) => ReactNode;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  compact?: boolean;
}

export function DataTable<T>({ columns, data, rowKey, onRowClick, emptyMessage = "No data", compact }: DataTableProps<T>) {
  const py = compact ? "py-1.5" : "py-2.5";
  const fontSize = compact ? "text-[9px]" : "text-[10px]";

  return (
    <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid hsla(0,0%,100%,0.05)" }}>
      <table className="w-full font-mono" style={{ minWidth: 600 }}>
        <thead>
          <tr style={{ background: "hsla(0,0%,100%,0.02)", borderBottom: "1px solid hsla(0,0%,100%,0.06)" }}>
            {columns.map(col => (
              <th
                key={col.key}
                className={`${py} px-3 ${fontSize} tracking-wider uppercase text-muted-foreground/30 font-bold whitespace-nowrap ${col.sticky ? "sticky left-0 z-10 bg-background" : ""}`}
                style={{ textAlign: col.align ?? "left", width: col.width }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="py-8 text-center text-muted-foreground/20 text-[10px]">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, idx) => (
              <tr
                key={rowKey(row)}
                className={`transition-colors ${onRowClick ? "cursor-pointer hover:bg-white/[0.02]" : ""}`}
                style={{ borderBottom: "1px solid hsla(0,0%,100%,0.03)" }}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map(col => (
                  <td
                    key={col.key}
                    className={`${py} px-3 ${fontSize} whitespace-nowrap ${col.sticky ? "sticky left-0 z-10 bg-background" : ""}`}
                    style={{ textAlign: col.align ?? "left" }}
                  >
                    {col.render(row, idx)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
