import { useState } from 'react';
import { writeJSON } from '../lib/storage';
import { useToast } from './Toast';

export function LocationButton() {
  const toast = useToast();
  const [label, setLabel] = useState('📍');
  const locate = () => {
    if (!navigator.geolocation) {
      toast('Location not supported on this browser.');
      return;
    }
    setLabel('Locating…');
    navigator.geolocation.getCurrentPosition(
      () => {
        setLabel('📍 Near you');
        writeJSON('iwillfly-location', 'on');
        toast('Location enabled for nearby offers.');
      },
      () => {
        setLabel('📍 Set location');
        toast('Location permission was not enabled.');
      },
      { timeout: 5000 },
    );
  };
  return (
    <button className="icon-btn" title="Enable location" onClick={locate}>
      {label}
    </button>
  );
}
