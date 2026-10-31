import * as reportClient from '../../packages/report-client/src/index';
import '../../prototypes/xeno-workspace/report.css';
import '../../prototypes/xeno-workspace/report-capture.js';
// One implementation serves both the workspace and React platform routes.
(window as unknown as {XenoReportClient:typeof reportClient}).XenoReportClient=reportClient;
void import('../../prototypes/xeno-workspace/report-view.js');
