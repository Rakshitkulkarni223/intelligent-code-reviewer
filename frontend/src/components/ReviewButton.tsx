interface Props {
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}

export default function ReviewButton({ onClick, loading, disabled }: Props) {
  return (
    <button className="btn btn-primary" onClick={onClick} disabled={disabled || loading}>
      {loading ? 'Submitting…' : 'Review Code'}
    </button>
  );
}
