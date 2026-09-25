import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog } from "./ui/Dialog.js";
import { Button } from "./ui/Button.js";

export function UnsavedChangesGuard({ dirty }: { dirty: boolean }) {
  const navigate = useNavigate();
  const [destination, setDestination] = useState<string>();
  const allow = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    function unload(event: BeforeUnloadEvent) {
      if (allow.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    function click(event: MouseEvent) {
      if (allow.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
      event.preventDefault();
      event.stopPropagation();
      setDestination(url.pathname + url.search + url.hash);
    }
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", click, true); };
  }, [dirty]);
  return destination ? <Dialog title="Descartar alterações?" onClose={() => setDestination(undefined)}>
    <p>As informações preenchidas serão perdidas.</p>
    <div className="ui-form__actions">
      <Button onClick={() => setDestination(undefined)}>Continuar editando</Button>
      <Button variant="danger" onClick={() => { allow.current = true; navigate(destination); }}>Descartar e sair</Button>
    </div>
  </Dialog> : null;
}
