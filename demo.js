import dotenv from 'dotenv';
import axios from 'axios';
import { Client } from '@elastic/elasticsearch';
import fs from 'node:fs';
import split2 from 'split2';

/**
 * Creates an index mapping via elastic javascript client
 */
async function createIndexMapping(client, indexName, inferenceId) {  
    const resp = await client.indices.create({
        index: indexName,
        mappings: {
            properties: {
                link: { type: 'text' },
                headline: {
                    type: 'text',
                    fields: {
                        semantic: {
                            type: 'semantic_text',
                            inference_id: inferenceId 
                        }
                    }
                },
                category: {
                    type: 'text',
                    fields: { keyword: { type: 'keyword' } }
                },
                short_description: {
                    type: 'text',
                    fields: {
                        semantic: {
                            type: 'semantic_text',
                            inference_id: inferenceId
                        }
                    }
                },
                authors: { type: 'text' },
                date: { type: 'date' }
            }
        }
    });
    console.log(resp);
}

/**
 * Creates an inference endpoint via elastic javascript client
 */
async function createInferenceEP(client, inferenceId) {
    const response = await client.inference.put({
        task_type: "text_embedding",
        inference_id: inferenceId,
        inference_config: {
            service: "azureopenai",
                service_settings: {
                    api_key: process.env.AZURE_OPENAI_API_KEY,
                    resource_name: process.env.AZURE_OPENAI_RESOURCE_NAME,
                    deployment_id: process.env.AZURE_OPENAI_DEPLOYMENT_ID,
                    api_version: process.env.AZURE_OPENAI_API_VERSION,
                },
        },
    });
    console.log(response);
}

/**
 * Createa Serverless Project via REST API
 */ 
async function createProject(name, url, key) {
    const parms = {
        name: name,
        region_id:"aws-us-east-1",
        optimized_for:"vector"
    };

    let resp = await axios.post(url, parms, {
        headers: {
            'Authorization': `ApiKey ${key}`,
            'Content-Type': 'application/json'
        }
    });

    if (resp.status === 201) {
        console.log(resp.data);
        return resp.data;
    }
    else {
        throw new Error(resp.error);
    }
}

/**
 * Deletes Serverless Project via REST API
 */
async function deleteProject(id) {
    let resp = await axios.delete(`${process.env.ELASTIC_API_URL}/${id}`, {
        headers: {
            'Authorization': `ApiKey ${process.env.ELASTIC_API_KEY}`,
            'Content-Type': 'application/json'
        }
    });

    if (resp.status === 200) {
        console.log(resp.data);
    }
    else {
        throw new Error(resp.error);
    }
}

/**
 * Bulk loads data via elastic javascript client
 */
async function loadData(client, filePath, indexName) {
    const result = await client.helpers.bulk({
        datasource: fs.createReadStream(filePath).pipe(split2()),
        onDocument: () => {
            return {
                index: {_index: indexName}
            };
        },
        refreshOnCompletion: true
    });
    console.log(`${result.successful} documents indexed`);
}

/**
 * Waits for serverless project creation to complete
 */
async function projectReady(id, url, key) {
    const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve,ms));

    const getProjectStatus = async () => {
        const resp = await axios.get(`${url}/${id}/status`, {
            headers: {
                'Authorization': `ApiKey ${key}`,
                'Content-Type': 'application/json'
            }
        });

        if (resp.status === 200) {
            return resp.data.phase;
        }
        else    {
            throw new Error(resp.error);
        }
    }
    
    let status = '';
    do {
        await sleep(5000);
        status = await getProjectStatus(id, url, key);
    } while (status !== 'initialized');
    console.log(status);
}

/**
 * Performs a semantic search for the given text on the 'short_description' field
 */
async function semanticSearch(client, indexName, text) {
    const res = await client.search({
        index: indexName,
        size: 1,
        query: {
            semantic: {
                field: 'short_description.semantic',
                query: text
            }
        }
    });
    console.log(res.hits.hits);
}


(async () => {
    try {
        dotenv.config({'override': true});

        console.log('***Creating Project***\n')
        const project = await createProject(
            process.env.PROJECT_NAME,
            process.env.ELASTIC_API_URL,
            process.env.ELASTIC_API_KEY
        );

        console.log('\n***Awaiting Project to be Ready***\n')
        await projectReady(
            project.id, 
            process.env.ELASTIC_API_URL, 
            process.env.ELASTIC_API_KEY
        );
    
        const client = new Client({
            cloud: { id: project.cloud_id },
            auth: project.credentials,
            serverMode: 'serverless'
        });

        console.log('\n***Creating Inference Endpoint***\n');
        await createInferenceEP(
            client, 
            process.env.INFERENCE_ID
        );

        console.log('\n***Creating Index Mapping***\n');
        await createIndexMapping(
            client,
            process.env.INDEXNAME,
            process.env.INFERENCE_ID
        );    
    
        console.log('\n***Loading Data***\n');
        await loadData(
            client, 
            process.env.FILEPATH, 
            process.env.INDEXNAME,
            process.env.INFERENCE_ID
        );

        console.log('\n***Semantic Search:"punk rock"***\n');
        await semanticSearch(
            client,
            process.env.INDEXNAME,
            'punk rock'
        );

        console.log('\n***Deleting project***\n');
        await deleteProject(project.id);
    }
    catch(error) {
        console.error(error);
    }
})();