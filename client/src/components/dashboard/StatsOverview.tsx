import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { 
  FolderOpen, 
  CheckCircle, 
  Clock, 
  Zap, 
  TrendingUp,
  Users,
  Shield,
  Globe
} from 'lucide-react';
import { ProjectsAPI, AnalyticsAPI } from '@/lib/api';

interface StatItem {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  color: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
}

interface StatsOverviewProps {
  className?: string;
}

export const StatsOverview: React.FC<StatsOverviewProps> = ({ className }) => {
  const [stats, setStats] = useState<StatItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [projects, analytics] = await Promise.all([
          ProjectsAPI.getProjects(),
          AnalyticsAPI.getOverallAnalytics()
        ]);

        const totalProjects = projects.length;
        const successfulDeployments = analytics.projects.reduce((acc, curr) => acc + curr.deployments, 0);
        const averageSuccessRate = analytics.projects.reduce((acc, curr) => acc + curr.successRate, 0) / analytics.projects.length;
        const totalBuildTime = analytics.projects.reduce((acc, curr) => acc + curr.buildTime, 0);
        const hoursSaved = Math.round(totalBuildTime / 3600); // Convert seconds to hours

        setStats([
          {
            label: 'Total Projects',
            value: totalProjects,
            icon: <FolderOpen className="h-5 w-5" />,
            color: 'text-primary'
          },
          {
            label: 'Successful Deployments',
            value: successfulDeployments,
            icon: <CheckCircle className="h-5 w-5" />,
            color: 'text-status-success'
          },
          {
            label: 'Hours Saved',
            value: hoursSaved,
            icon: <Clock className="h-5 w-5" />,
            color: 'text-muted-foreground'
          },
          {
            label: 'Success Rate',
            value: `${Math.round(averageSuccessRate)}%`,
            icon: <Zap className="h-5 w-5" />,
            color: 'text-status-warning'
          }
        ]);
      } catch (error) {
        console.error('Failed to fetch stats:', error);
        // Set default values in case of error
        setStats([
          {
            label: 'Total Projects',
            value: 0,
            icon: <FolderOpen className="h-5 w-5" />,
            color: 'text-primary'
          },
          {
            label: 'Successful Deployments',
            value: 0,
            icon: <CheckCircle className="h-5 w-5" />,
            color: 'text-status-success'
          },
          {
            label: 'Hours Saved',
            value: 0,
            icon: <Clock className="h-5 w-5" />,
            color: 'text-muted-foreground'
          },
          {
            label: 'Success Rate',
            value: '0%',
            icon: <Zap className="h-5 w-5" />,
            color: 'text-status-warning'
          }
        ]);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 ${className}`}>
      {stats.map((stat, index) => (
        <Card key={index} className="border-border bg-card">
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className={`rounded-md bg-muted p-3 ${stat.color}`}>
                {stat.icon}
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
                <h3 className="text-2xl font-semibold">{stat.value}</h3>
                {stat.trend && (
                  <div className="flex items-center mt-1">
                     <TrendingUp className={`h-4 w-4 ${stat.trend.isPositive ? 'text-status-success' : 'text-status-error'}`} />
                     <span className={`ml-1 text-sm ${stat.trend.isPositive ? 'text-status-success' : 'text-status-error'}`}>
                      {stat.trend.value}%
                    </span>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

// Default stats configuration
export const defaultStats: StatItem[] = [
  {
    label: 'Total Projects',
    value: 0,
    icon: <FolderOpen className="h-5 w-5" />,
    color: 'text-primary',
    trend: { value: 12, isPositive: true }
  },
  {
    label: 'Successful Deployments',
    value: 0,
    icon: <CheckCircle className="h-5 w-5" />,
    color: 'text-status-success',
    trend: { value: 8, isPositive: true }
  },
  {
    label: 'Hours Saved',
    value: 0,
    icon: <Clock className="h-5 w-5" />,
    color: 'text-muted-foreground',
    trend: { value: 15, isPositive: true }
  },
  {
    label: 'Active Pipelines',
    value: 0,
    icon: <Zap className="h-5 w-5" />,
    color: 'text-status-warning'
  }
];
