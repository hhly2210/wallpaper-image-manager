import React from 'react';
import { useCurrentUploadJob, useUploadJobActions } from '../stores/uploadJobStore';

export const UploadJobTracker: React.FC = () => {
  const currentJob = useCurrentUploadJob();
  const { getJob } = useUploadJobActions();

  if (!currentJob) {
    return null;
  }

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString();
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: 20,
      right: 20,
      background: 'white',
      border: '1px solid #ddd',
      borderRadius: '8px',
      padding: '16px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      minWidth: '300px',
      zIndex: 1000
    }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '600' }}>
        {currentJob.name}
      </h3>

      <div style={{ marginBottom: '8px' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '14px',
          marginBottom: '4px'
        }}>
          <span>Progress:</span>
          <span>{currentJob.progress}% ({currentJob.uploadedFiles}/{currentJob.totalFiles})</span>
        </div>

        <div style={{
          width: '100%',
          height: '8px',
          backgroundColor: '#f0f0f0',
          borderRadius: '4px',
          overflow: 'hidden'
        }}>
          <div style={{
            width: `${currentJob.progress}%`,
            height: '100%',
            backgroundColor: currentJob.status === 'completed' ? '#00a651' :
                           currentJob.status === 'failed' ? '#e74c3c' : '#3498db',
            transition: 'width 0.3s ease'
          }} />
        </div>
      </div>

      <div style={{
        fontSize: '12px',
        color: '#666',
        display: 'flex',
        justifyContent: 'space-between'
      }}>
        <span>Status: {currentJob.status}</span>
        <span>Updated: {formatTime(currentJob.updatedAt)}</span>
      </div>

      {currentJob.error && (
        <div style={{
          marginTop: '8px',
          padding: '8px',
          backgroundColor: '#fee',
          border: '1px solid #fcc',
          borderRadius: '4px',
          fontSize: '12px',
          color: '#c33'
        }}>
          Error: {currentJob.error}
        </div>
      )}
    </div>
  );
};