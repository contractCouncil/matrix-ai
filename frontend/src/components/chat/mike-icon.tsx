"use client";

import React from "react";
import Image from "next/image";

interface MatrixAIIconProps {
    spin?: boolean;
    done?: boolean;
    error?: boolean;
    mike?: boolean;
    size?: number;
    style?: React.CSSProperties;
}

export function MatrixAIIcon({
    spin = false,
    done = false,
    error = false,
    mike = false,
    size = 24,
    style,
}: MatrixAIIconProps) {
    void mike;

    const ringClass = error
        ? "ring-1 ring-red-400"
        : done
          ? "ring-1 ring-emerald-400"
          : "";

    return (
        <span
            className={`shrink-0 inline-block rounded-full overflow-hidden ${ringClass} ${
                spin ? "animate-spin" : ""
            }`}
            style={{
                width: size,
                height: size,
                animationDuration: spin ? "3s" : undefined,
                ...style,
            }}
        >
            <Image
                src="/logo.jpeg"
                alt="Matrix AI"
                width={size}
                height={size}
                className="block w-full h-full object-cover"
                priority
            />
        </span>
    );
}
