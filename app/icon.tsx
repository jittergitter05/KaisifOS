import { ImageResponse } from 'next/og';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0f172a',
          borderRadius: 128,
        }}
      >
        <div style={{ display: 'flex', position: 'relative', width: 256, height: 384 }}>
          {/* Vertical line passing down */}
          <div
            style={{
              position: 'absolute',
              left: 48,
              top: 0,
              width: 32,
              height: 384,
              backgroundColor: 'white',
            }}
          />
          {/* Top diagonal */}
          <div
            style={{
              position: 'absolute',
              left: 80,
              top: 192,
              width: 176,
              height: 12,
              backgroundColor: 'white',
              transform: 'rotate(-45deg)',
              transformOrigin: 'left center',
            }}
          />
          {/* Bottom diagonal */}
          <div
            style={{
              position: 'absolute',
              left: 80,
              top: 192,
              width: 176,
              height: 12,
              backgroundColor: 'white',
              transform: 'rotate(45deg)',
              transformOrigin: 'left center',
            }}
          />
        </div>
      </div>
    ),
    { ...size }
  );
}
