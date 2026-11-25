import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
    size?: "default" | "sm" | "lg" | "icon";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant = "default", size = "default", ...props }, ref) => {
        const baseStyles = "box-border inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap leading-none font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-4";

        const variants = {
            default: "bg-red-600 text-white hover:bg-red-700 shadow-lg shadow-red-500/20",
            destructive: "border border-red-400/35 bg-[#a91f2b] text-white shadow-[0_2px_10px_rgba(220,38,38,0.14)] hover:border-red-300/50 hover:bg-[#bd2634] hover:shadow-[0_4px_14px_rgba(220,38,38,0.22)]",
            outline: "border border-white/10 bg-transparent text-white hover:bg-white/10",
            secondary: "bg-white/10 text-white hover:bg-white/20",
            ghost: "text-white/70 hover:bg-white/10 hover:text-white",
            link: "text-red-400 underline-offset-4 hover:underline",
        };

        const sizes = {
            default: "h-10 px-4 py-2 rounded-lg text-sm",
            sm: "h-8 px-3 rounded-md text-xs",
            lg: "h-12 px-6 rounded-lg text-base",
            icon: "size-10 min-w-10 rounded-xl p-0",
        };

        return (
            <button
                className={cn(baseStyles, variants[variant], sizes[size], className)}
                ref={ref}
                {...props}
            />
        );
    }
);
Button.displayName = "Button";

export { Button };
