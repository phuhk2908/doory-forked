import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthProvider";
import { drawingsApi } from "@/lib/api";
import { drawingLocalRepository } from "@/drawing/local";
import {
  EditorProblemPage,
  EditorSkeleton,
} from "@/features/editor/EditorStates";
import { usePageMeta } from "@/lib/usePageMeta";

export default function CreateDrawingPage() {
  const navigate = useNavigate();
  const { status } = useAuth();
  const started = useRef(false);
  const [failed, setFailed] = useState(false);
  usePageMeta({ title: "Creating your whiteboard", noindex: true });

  useEffect(() => {
    if (status === "loading" || started.current) return;
    started.current = true;
    void (async () => {
      try {
        if (status === "authenticated") {
          const drawing = await drawingsApi.create();
          navigate("/drawings/" + drawing.id, { replace: true });
        } else {
          const drawing = await drawingLocalRepository.create();
          navigate("/drawings/local/" + drawing.id, { replace: true });
        }
      } catch {
        started.current = false;
        setFailed(true);
      }
    })();
  }, [navigate, status]);

  if (failed) {
    return (
      <EditorProblemPage problem="error" onRetry={() => setFailed(false)} />
    );
  }
  return <EditorSkeleton label="Setting up your whiteboard" />;
}
