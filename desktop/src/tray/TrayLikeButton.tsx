import { HoldHeart } from '../components/music/superlike/HoldHeart';
import { heartTitle } from '../components/music/superlike/heart-title';
import { useHeartGesture } from '../components/music/superlike/useHeartGesture';
import i18n from '../i18n';
import { sendCmd } from './state';

export function TrayLikeButton({
  liked,
  superliked,
  blocked,
}: {
  liked: boolean;
  superliked: boolean;
  blocked: boolean;
}) {
  const gesture = useHeartGesture({
    onTap: () => sendCmd('like'),
    onSuperlike: () => {
      sendCmd('superlike');
      return !superliked && !blocked;
    },
  });
  return (
    <button
      type="button"
      {...gesture.handlers}
      className={`tp-icon-btn ${liked ? 'is-like' : ''}`}
      title={heartTitle(i18n.t, liked, superliked)}
    >
      <HoldHeart liked={liked} superliked={superliked} size={16} gesture={gesture} />
    </button>
  );
}
