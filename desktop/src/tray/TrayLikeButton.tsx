import i18n from '../i18n';
import { HoldHeart } from '../components/music/superlike/HoldHeart';
import { useHeartGesture } from '../components/music/superlike/useHeartGesture';
import { sendCmd } from './state';

export function TrayLikeButton({ liked, superliked }: { liked: boolean; superliked: boolean }) {
  const gesture = useHeartGesture({
    onTap: () => sendCmd('like'),
    onSuperlike: () => {
      sendCmd('superlike');
      return !superliked;
    },
  });
  return (
    <button
      type="button"
      {...gesture.handlers}
      className={`tp-icon-btn ${liked ? 'is-like' : ''}`}
      title={`${i18n.t('track.likes')} · ${i18n.t('superlike.holdHint')}`}
    >
      <HoldHeart liked={liked} superliked={superliked} size={16} gesture={gesture} />
    </button>
  );
}
