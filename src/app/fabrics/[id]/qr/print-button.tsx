"use client";

import { Button } from "@/components/ui";

/** Печать вызывается только из браузера — поэтому отдельный клиентский компонент */
export function PrintButton() {
  return (
    <Button variant="primary" onClick={() => window.print()}>
      Печать
    </Button>
  );
}
