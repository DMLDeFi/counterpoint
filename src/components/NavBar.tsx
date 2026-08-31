"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Debate" },
  { href: "/compare", label: "Compare" },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-neutral-900 bg-black">
      <div className="mx-auto flex w-full max-w-3xl gap-1 px-4 py-3 sm:px-6">
        {LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-neutral-600 ${
                active ? "bg-neutral-800 text-neutral-50" : "text-neutral-500 hover:text-neutral-200"
              }`}
              aria-current={active ? "page" : undefined}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
