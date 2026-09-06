interface Props {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export default function ErrorState({ title = 'Something went wrong', message, onRetry }: Props) {
  return (
    <div className="state-block" role="alert">
      <div className="state-icon" aria-hidden="true">⚠️</div>
      <div className="state-title">{title}</div>
      <p>{message}</p>
      {onRetry && (
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
