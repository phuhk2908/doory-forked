import { PenLine, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { drawingsApi } from "@/lib/api";
import { qk } from "@/lib/api/keys";
import { usePageTitle } from "@/lib/usePageTitle";
import { Button, EmptyState, Skeleton, Thumbnail } from "@/ui";
import styles from "./pageStyles.module.css";

export default function DrawingsPage() {
  usePageTitle("Whiteboards");
  const navigate = useNavigate();
  const list = useQuery({
    queryKey: qk.drawings.list({}),
    queryFn: ({ signal }) => drawingsApi.list({}, signal),
    staleTime: 30_000,
  });
  const drawings = list.data?.results ?? [];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h1 className={styles.title}>Whiteboards</h1>
          <p className={styles.lead}>
            Sketch ideas, diagrams and flows on an infinite canvas.
          </p>
        </div>
        <Button
          leftIcon={<Plus size={16} />}
          onClick={() => navigate("/drawings/new")}
        >
          New whiteboard
        </Button>
      </header>
      {list.isPending ? (
        <ul className={styles.grid} aria-label="Loading whiteboards">
          {Array.from({ length: 4 }, (_, index) => (
            <li key={index} className={styles.skeletonCard}>
              <Skeleton height="11rem" radius="var(--radius-lg)" />
              <Skeleton width="65%" height={16} />
            </li>
          ))}
        </ul>
      ) : list.isError ? (
        <EmptyState
          title="Your whiteboards didn’t load"
          description="Check your connection and try again."
          role="alert"
          action={
            <Button onClick={() => void list.refetch()}>Try again</Button>
          }
        />
      ) : drawings.length === 0 ? (
        <EmptyState
          icon={<PenLine size={28} />}
          title="No whiteboards yet"
          description="Start with a blank infinite canvas."
          action={<Link to="/drawings/new">Create a whiteboard</Link>}
        />
      ) : (
        <ul className={styles.grid}>
          {drawings.map((drawing) => (
            <li key={drawing.id}>
              <Link
                to={"/drawings/" + drawing.id}
                className={styles.drawingCard}
              >
                <Thumbnail
                  src={drawing.thumbnail_url}
                  alt=""
                  aspect={4 / 3}
                  fit="contain"
                  className={styles.drawingThumb}
                />
                <span className={styles.drawingTitle}>{drawing.title}</span>
                <span className={styles.drawingMeta}>
                  Updated {new Date(drawing.updated_at).toLocaleDateString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
