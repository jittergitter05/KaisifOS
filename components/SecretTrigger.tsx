'use client';
import { useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';

export default function SecretTrigger({ children }: { children: ReactNode }) {
  const [taps, setTaps] = useState(0);
  const router = useRouter();

  const handleTap = () => {
    const newTaps = taps + 1;
    setTaps(newTaps);
    if (newTaps >= 5) {
      router.push('/login');
    }
    
    // Reset taps after 3 seconds of inactivity
    setTimeout(() => {
      setTaps((prev) => (prev > 0 ? prev - 1 : 0));
    }, 3000);
  };

  return (
    <div onClick={handleTap} className="cursor-default select-none inline-block">
      {children}
    </div>
  );
}
