import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import "./field.css";

/** The Fuwari slider: a native range input tinted with the theme's accent. */
export function Slider({ className, ...props }: ComponentProps<"input">) {
  return (
    <input type="range" className={cn("fuwari-slider", className)} {...props} />
  );
}
