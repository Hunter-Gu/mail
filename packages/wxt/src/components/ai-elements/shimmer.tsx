"use client";

import type { CSSProperties, ElementType, ReactNode } from "react";
import { memo } from "react";

import { cn } from "@/src/ai-elements/utils";

export interface TextShimmerProps {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  duration?: number;
}

const ShimmerComponent = ({
  children,
  as: Component = "p",
  className,
  duration = 2,
}: TextShimmerProps) => (
  <Component
    className={cn(
      "ai-shimmer-text",
      "inline-block bg-clip-text text-transparent",
      "bg-[linear-gradient(90deg,var(--color-muted-foreground),var(--color-foreground),var(--color-muted-foreground))] bg-[length:200%_100%]",
      "animate-[ai-shimmer_var(--ai-shimmer-duration)_linear_infinite]",
      className
    )}
    style={
      {
        "--ai-shimmer-duration": `${duration}s`,
      } as CSSProperties
    }
  >
    {children}
  </Component>
);

export const Shimmer = memo(ShimmerComponent);
