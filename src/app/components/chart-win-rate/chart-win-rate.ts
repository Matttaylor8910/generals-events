import {DatePipe} from '@angular/common';
import {Component, Input, OnChanges, OnDestroy} from '@angular/core';
import Chart from 'chart.js';
import {map, uniqueId} from 'lodash';
import {ma} from 'moving-averages';
import {Subject} from 'rxjs';

@Component({
  selector: 'app-chart-win-rate',
  templateUrl: './chart-win-rate.html',
  styleUrls: ['./chart-win-rate.scss'],
})
export class ChartWinRateComponent implements OnChanges, OnDestroy {
  private destroyed$ = new Subject<void>();

  @Input() title: string;
  @Input() data: any[];
  @Input() xAxis: string;
  @Input() yAxis: string;
  @Input() xIsDate = false;
  @Input() bucketSize = 200;

  chart: any;
  uniqueId: string = uniqueId();

  lastDataString = '';

  constructor() {}

  ngOnChanges() {
    if (this.data?.length) {
      // always kill the previous observable
      this.destroyed$.next();
      setTimeout(() => {
        this.updateChart(this.data);
      });
    }
  }

  updateChart(dataPoints) {
    // prevent the chart from updating if there is nothing different
    const dataString = JSON.stringify(dataPoints);
    if (this.lastDataString === dataString) {
      return;
    }
    // if this is a new chart, save the data, then continue
    else {
      this.lastDataString = dataString;
    }

    const datePipe = new DatePipe('en-US');
    const data = this.getMovingAverage(dataPoints, this.yAxis);
    const dates = this.getMovingAverage(dataPoints, this.xAxis)
                      .map(
                          d => this.xIsDate ?
                              datePipe.transform(new Date(d), 'MM/dd/yyyy') :
                              Math.floor(d));

    const chartId = `chart-${this.uniqueId}`;
    this.chart = new Chart(chartId, {
      type: 'line',
      data: {
        labels: dates,
        datasets: [{
          label: 'Elo',
          data: data,
          backgroundColor: 'rgba(72,138,255,0)',
          borderColor: 'teal',
          borderWidth: 2
        }]
      },
      options: {
        elements: {
          point: {radius: 0},
          line: {tension: 0.3},  // tension: 0 is no curves
        },
        layout: {padding: {left: 0, right: 0, top: 0, bottom: 0}},
        legend: {display: false},
        scales: {
          yAxes: [{ticks: {maxTicksLimit: 6}}],
          xAxes: [{gridLines: {display: false}, ticks: {autoSkipPadding: 10}}]
        },
        title: {
          display: this.title !== undefined,
          text: this.title,
        },
        maintainAspectRatio: false
      }
    });
  }

  getMovingAverage(data: any[], field: string) {
    const bucketSize = data.length > this.bucketSize * 2 ?
        this.bucketSize :
        Math.floor(data.length / 10);
    return ma(map(data, field), bucketSize).filter(d => d >= 0)
  }

  ngOnDestroy() {
    this.destroyed$.next();
  }
}
