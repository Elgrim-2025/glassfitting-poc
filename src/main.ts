import './style.css';
import { App } from './platform/app';

const root = document.getElementById('app');
if (!root) throw new Error('#app not found');
new App(root).init().catch((err) => {
  console.error(err);
  alert(`초기화 실패: ${err instanceof Error ? err.message : err}`);
});
