import {ApolloQueryResult, gql, useQuery} from '@apollo/client';
import * as React from 'react';

import {PYTHON_ERROR_FRAGMENT} from '../app/PythonErrorInfo';
import {NAV_SCHEDULE_FRAGMENT, NAV_SENSOR_FRAGMENT} from '../nav/FlatContentList';
import {PipelineSelector} from '../types/globalTypes';

import {REPOSITORY_INFO_FRAGMENT} from './RepositoryInformation';
import {buildRepoAddress} from './buildRepoAddress';
import {findRepoContainingPipeline} from './findRepoContainingPipeline';
import {RepoAddress} from './types';
import {
  RootRepositoriesQuery,
  RootRepositoriesQuery_workspaceOrError,
  RootRepositoriesQuery_workspaceOrError_PythonError,
  RootRepositoriesQuery_workspaceOrError_Workspace_locationEntries,
  RootRepositoriesQuery_workspaceOrError_Workspace_locationEntries_locationOrLoadError_RepositoryLocation,
  RootRepositoriesQuery_workspaceOrError_Workspace_locationEntries_locationOrLoadError_RepositoryLocation_repositories,
} from './types/RootRepositoriesQuery';

type Repository = RootRepositoriesQuery_workspaceOrError_Workspace_locationEntries_locationOrLoadError_RepositoryLocation_repositories;
type RepositoryLocation = RootRepositoriesQuery_workspaceOrError_Workspace_locationEntries_locationOrLoadError_RepositoryLocation;
type RepositoryLocationNode = RootRepositoriesQuery_workspaceOrError_Workspace_locationEntries;
type RepositoryError = RootRepositoriesQuery_workspaceOrError_PythonError;

export interface DagsterRepoOption {
  repositoryLocation: RepositoryLocation;
  repository: Repository;
}

type WorkspaceState = {
  error: RepositoryError | null;
  loading: boolean;
  locationEntries: RepositoryLocationNode[];
  allRepos: DagsterRepoOption[];
  refetch: () => Promise<ApolloQueryResult<unknown>>;
};

export const WorkspaceContext = React.createContext<WorkspaceState>(
  new Error('WorkspaceContext should never be uninitialized') as any,
);

export const ROOT_WORKSPACE_FRAGMENT = gql`
  fragment RootWorkspaceFragment on Workspace {
    locationEntries {
      __typename
      id
      name
      loadStatus
      displayMetadata {
        key
        value
      }
      updatedTimestamp
      locationOrLoadError {
        ... on RepositoryLocation {
          id
          isReloadSupported
          serverId
          name
          repositories {
            id
            name
            pipelines {
              id
              name
              isJob
              graphName
              pipelineSnapshotId
              modes {
                id
                name
              }
              schedules {
                id
                ...NavScheduleFragment
              }
              sensors {
                id
                ...NavSensorFragment
              }
            }
            partitionSets {
              id
              mode
              pipelineName
            }
            ...RepositoryInfoFragment
          }
        }
        ... on PythonError {
          ...PythonErrorFragment
        }
      }
    }
  }
  ${PYTHON_ERROR_FRAGMENT}
  ${REPOSITORY_INFO_FRAGMENT}
  ${NAV_SCHEDULE_FRAGMENT}
  ${NAV_SENSOR_FRAGMENT}
`;

const ROOT_REPOSITORIES_QUERY = gql`
  query RootRepositoriesQuery {
    workspaceOrError {
      __typename
      ... on Workspace {
        ...RootWorkspaceFragment
      }
      ...PythonErrorFragment
    }
  }
  ${ROOT_WORKSPACE_FRAGMENT}
  ${PYTHON_ERROR_FRAGMENT}
`;

export const REPOSITORY_LOCATIONS_FRAGMENT = gql`
  fragment RepositoryLocationsFragment on WorkspaceOrError {
    __typename
    ... on Workspace {
      locationEntries {
        __typename
        id
        name
        loadStatus
        displayMetadata {
          key
          value
        }
        updatedTimestamp
        locationOrLoadError {
          ... on RepositoryLocation {
            id
            isReloadSupported
            serverId
            name
          }
          ... on PythonError {
            message
          }
        }
      }
    }
    ...PythonErrorFragment
  }
  ${PYTHON_ERROR_FRAGMENT}
`;

export const getRepositoryOptionHash = (a: DagsterRepoOption) =>
  `${a.repository.name}:${a.repositoryLocation.name}`;

/**
 * A hook that supplies the current workspace state of Dagit, including the current
 * "active" repo based on the URL or localStorage, all fetched repositories available
 * in the workspace, and loading/error state for the relevant query.
 *
 * Note: This is split into a fetcher and a formatter hook so that a separate query can
 * be used to retrieve workspace snapshots.
 */
const useWorkspaceState = () => {
  const {data, loading, refetch} = useQuery<RootRepositoriesQuery>(ROOT_REPOSITORIES_QUERY, {
    fetchPolicy: 'cache-and-network',
  });

  const {error, locationEntries, allRepos} = useRepoOptionsFromWorkspace(data?.workspaceOrError);

  return {
    refetch,
    loading: loading && !data, // Only "loading" on initial load.
    error,
    locationEntries,
    allRepos,
  };
};

export const useRepoOptionsFromWorkspace = (
  workspaceOrError: RootRepositoriesQuery_workspaceOrError | null | undefined,
) => {
  const locationEntries = React.useMemo(
    () => (workspaceOrError?.__typename === 'Workspace' ? workspaceOrError.locationEntries : []),
    [workspaceOrError],
  );

  const {options, error} = React.useMemo(() => {
    let options: DagsterRepoOption[] = [];
    if (!workspaceOrError) {
      return {options, error: null};
    }

    if (workspaceOrError.__typename === 'PythonError') {
      return {options, error: workspaceOrError};
    }

    options = workspaceOrError.locationEntries.reduce((accum, locationEntry) => {
      if (locationEntry.locationOrLoadError?.__typename !== 'RepositoryLocation') {
        return accum;
      }
      const repositoryLocation = {...locationEntry.locationOrLoadError};
      const reposForLocation = repositoryLocation.repositories.map((repository) => {
        return {repository, repositoryLocation};
      });
      return [...accum, ...reposForLocation];
    }, [] as DagsterRepoOption[]);

    return {error: null, options};
  }, [workspaceOrError]);

  return {locationEntries, allRepos: options, error};
};

export const WorkspaceProvider: React.FC = (props) => {
  const {children} = props;
  const workspaceState = useWorkspaceState();
  return <WorkspaceContext.Provider value={workspaceState}>{children}</WorkspaceContext.Provider>;
};

export const useRepositoryOptions = () => {
  const {allRepos: options, loading, error} = React.useContext(WorkspaceContext);
  return {options, loading, error};
};

export const useRepository = (repoAddress: RepoAddress | null) => {
  const {options} = useRepositoryOptions();
  return findRepositoryAmongOptions(options, repoAddress) || null;
};

export const findRepositoryAmongOptions = (
  options: DagsterRepoOption[],
  repoAddress: RepoAddress | null,
) => {
  return repoAddress
    ? options.find(
        (option) =>
          option.repository.name === repoAddress.name &&
          option.repositoryLocation.name === repoAddress.location,
      )
    : null;
};

export const useActivePipelineForName = (pipelineName: string, snapshotId?: string) => {
  const {options} = useRepositoryOptions();
  const reposWithMatch = findRepoContainingPipeline(options, pipelineName, snapshotId);
  if (reposWithMatch.length) {
    const match = reposWithMatch[0];
    return match.repository.pipelines.find((pipeline) => pipeline.name === pipelineName) || null;
  }
  return null;
};

export const isThisThingAJob = (repo: DagsterRepoOption | null, pipelineOrJobName: string) => {
  const pipelineOrJob = repo?.repository.pipelines.find(
    (pipelineOrJob) => pipelineOrJob.name === pipelineOrJobName,
  );
  return !!pipelineOrJob?.isJob;
};

export const buildPipelineSelector = (
  repoAddress: RepoAddress | null,
  pipelineName: string,
  solidSelection?: string[],
) => {
  const repositorySelector = {
    repositoryName: repoAddress?.name || '',
    repositoryLocationName: repoAddress?.location || '',
  };

  return {
    ...repositorySelector,
    pipelineName,
    solidSelection,
  } as PipelineSelector;
};

export const optionToRepoAddress = (option: DagsterRepoOption) =>
  buildRepoAddress(option.repository.name, option.repository.location.name);
