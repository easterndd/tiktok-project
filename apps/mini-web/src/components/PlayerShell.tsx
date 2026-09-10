import { AlertCircle, Play } from 'lucide-react';
import styles from './PlayerShell.module.css';

export function PlayerShell({ message }: { message?: string }) {
  return <section className={styles.shell} aria-label="Drama player">
    {message ? <div className={styles.message}><AlertCircle size={20} aria-hidden="true" /><span>{message}</span></div> : <div className={styles.message}><Play size={24} aria-hidden="true" /><span>Preparing the official player...</span></div>}
  </section>;
}
