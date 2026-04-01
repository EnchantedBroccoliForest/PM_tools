import './AmbientOverlay.css';

export default function AmbientOverlay({ mode }) {
  return (
    <>
      <div className={`ambient-overlay ambient-overlay--leaves ${mode === 'sunny' ? 'ambient-overlay--visible' : ''}`}>
        <div className="leaves-layer leaves-layer--1" />
        <div className="leaves-layer leaves-layer--2" />
        <div className="leaves-layer leaves-layer--3" />
      </div>
      <div className={`ambient-overlay ambient-overlay--moon ${mode === 'moonlight' ? 'ambient-overlay--visible' : ''}`}>
        <div className="moon-layer moon-layer--glow" />
        <div className="moon-layer moon-layer--beams" />
        <div className="moon-layer moon-layer--stars" />
      </div>
      <div className={`ambient-overlay ambient-overlay--rain ${mode === 'rainy' ? 'ambient-overlay--visible' : ''}`}>
        <div className="rain-layer rain-layer--1" />
        <div className="rain-layer rain-layer--2" />
        <div className="rain-layer rain-layer--3" />
      </div>
    </>
  );
}
